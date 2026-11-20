import sql from 'mssql';
import { getPool } from './db.js';

const STAGE = '#dbsync_stage';
const STREAM_BATCH = 2000; // rows pulled from source before flushing to target
const MAX_PARAMS = 2000; // SQL Server allows 2100 parameters per request

const DATE_TYPES = new Set(['date', 'datetime', 'datetime2', 'smalldatetime', 'datetimeoffset']);
const INT_TYPES = new Set(['tinyint', 'smallint', 'int', 'bigint']);
const NON_COMPARABLE = new Set(['text', 'ntext', 'image', 'xml', 'geography', 'geometry']);
const NOT_INSERTABLE = new Set(['timestamp', 'rowversion']);
const CLR_TYPES = new Set(['geography', 'geometry', 'hierarchyid']);
const DATE_COLUMN_NAMES = ['dateadded', 'date_added'];

export const q = (name) => `[${String(name).replace(/]/g, ']]')}]`;
const fullName = (schema, table) => `${q(schema)}.${q(table)}`;
const lower = (s) => s.toLowerCase();

// ---------- metadata ----------

export async function listTables(pool) {
  const { recordset } = await pool.request().query(`
    SELECT s.name AS [schema], t.name AS [table],
      (SELECT SUM(p.rows) FROM sys.partitions p
        WHERE p.object_id = t.object_id AND p.index_id IN (0, 1)) AS [rowCount],
      (SELECT TOP 1 c.name FROM sys.columns c
        JOIN sys.types ty ON ty.user_type_id = c.system_type_id
        WHERE c.object_id = t.object_id
          AND LOWER(c.name) IN (${DATE_COLUMN_NAMES.map((n) => `'${n}'`).join(', ')})
          AND ty.name IN (${[...DATE_TYPES].map((n) => `'${n}'`).join(', ')})) AS dateColumn
    FROM sys.tables t
    JOIN sys.schemas s ON s.schema_id = t.schema_id
    WHERE t.is_ms_shipped = 0
    ORDER BY s.name, t.name`);
  return recordset.map((r) => ({ ...r, rowCount: Number(r.rowCount ?? 0) }));
}

export async function getColumns(pool, schema, table) {
  const { recordset } = await pool
    .request()
    .input('schema', sql.NVarChar, schema)
    .input('table', sql.NVarChar, table)
    .query(`
      SELECT c.name,
        CASE WHEN t.is_user_defined = 1 AND t.is_assembly_type = 0 THEN bt.name ELSE t.name END AS type,
        c.max_length AS maxLength, c.precision, c.scale,
        c.is_nullable AS isNullable, c.is_identity AS isIdentity, c.is_computed AS isComputed,
        CAST(ic.seed_value AS bigint) AS seed, CAST(ic.increment_value AS bigint) AS increment,
        cc.definition AS computedDefinition, cc.is_persisted AS isPersisted,
        dc.definition AS defaultDefinition, c.collation_name AS collation
      FROM sys.columns c
      JOIN sys.types t ON t.user_type_id = c.user_type_id
      LEFT JOIN sys.types bt ON bt.user_type_id = c.system_type_id
      LEFT JOIN sys.identity_columns ic ON ic.object_id = c.object_id AND ic.column_id = c.column_id
      LEFT JOIN sys.computed_columns cc ON cc.object_id = c.object_id AND cc.column_id = c.column_id
      LEFT JOIN sys.default_constraints dc ON dc.object_id = c.default_object_id
      WHERE c.object_id = OBJECT_ID(QUOTENAME(@schema) + '.' + QUOTENAME(@table), 'U')
      ORDER BY c.column_id`);
  return recordset;
}

export async function getPrimaryKey(pool, schema, table) {
  const { recordset } = await pool
    .request()
    .input('schema', sql.NVarChar, schema)
    .input('table', sql.NVarChar, table)
    .query(`
      SELECT c.name
      FROM sys.indexes i
      JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
      JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
      WHERE i.object_id = OBJECT_ID(QUOTENAME(@schema) + '.' + QUOTENAME(@table), 'U')
        AND i.is_primary_key = 1
      ORDER BY ic.key_ordinal`);
  return recordset.map((r) => r.name);
}

// Tables this table references through foreign keys (self-references excluded).
export async function getParentTables(pool, schema, table) {
  const { recordset } = await pool
    .request()
    .input('schema', sql.NVarChar, schema)
    .input('table', sql.NVarChar, table)
    .query(`
      SELECT DISTINCT rs.name AS [schema], rt.name AS [table]
      FROM sys.foreign_keys fk
      JOIN sys.tables rt ON rt.object_id = fk.referenced_object_id
      JOIN sys.schemas rs ON rs.schema_id = rt.schema_id
      WHERE fk.parent_object_id = OBJECT_ID(QUOTENAME(@schema) + '.' + QUOTENAME(@table), 'U')
        AND fk.referenced_object_id <> fk.parent_object_id`);
  return recordset;
}

// Parents from both DBs' foreign keys, ordered so every table comes after the tables it references.
export async function getDependencyOrder(source, target, schema, table) {
  const src = await getPool(source);
  const dst = target ? await getPool(target) : null;
  const order = [];
  const done = new Set();
  const visiting = new Set();
  const visit = async (s, t) => {
    const key = lower(`${s}.${t}`);
    if (done.has(key) || visiting.has(key)) return; // already handled, or an FK cycle
    visiting.add(key);
    const parents = [
      ...(await getParentTables(src, s, t)),
      ...(dst ? await getParentTables(dst, s, t) : []),
    ];
    for (const p of parents) await visit(p.schema, p.table);
    visiting.delete(key);
    done.add(key);
    order.push({ schema: s, table: t });
  };
  await visit(schema, table);
  return order.slice(0, -1); // everything except the table itself
}

const isWholeNumber = (c) =>
  INT_TYPES.has(c.type) || ((c.type === 'decimal' || c.type === 'numeric') && c.scale === 0);

// dateAdded column wins; otherwise an Id column (identity, single-column PK, or named "Id").
export function pickRangeColumn(columns, pk) {
  const date = columns.find((c) => DATE_COLUMN_NAMES.includes(lower(c.name)) && DATE_TYPES.has(c.type));
  if (date) return { mode: 'date', column: date.name };

  const id =
    columns.find((c) => c.isIdentity && isWholeNumber(c)) ||
    (pk.length === 1 && columns.find((c) => c.name === pk[0] && isWholeNumber(c))) ||
    columns.find((c) => lower(c.name) === 'id' && isWholeNumber(c));
  if (id) return { mode: 'id', column: id.name };

  return { mode: 'all', column: null };
}

export async function getTableInfo(conn, schema, table, target) {
  const pool = await getPool(conn);
  const columns = await getColumns(pool, schema, table);
  if (!columns.length) throw new Error(`Table ${schema}.${table} not found`);
  const pk = await getPrimaryKey(pool, schema, table);
  const range = pickRangeColumn(columns, pk);

  let min = null;
  let max = null;
  let rowCount;
  if (range.mode === 'all') {
    const r = await pool.request().query(`SELECT COUNT_BIG(*) AS cnt FROM ${fullName(schema, table)}`);
    rowCount = Number(r.recordset[0].cnt);
  } else {
    const col = q(range.column);
    const expr = (agg) =>
      range.mode === 'date' ? `CONVERT(varchar(10), ${agg}(${col}), 23)` : `CAST(${agg}(${col}) AS varchar(40))`;
    const r = await pool
      .request()
      .query(`SELECT ${expr('MIN')} AS minV, ${expr('MAX')} AS maxV, COUNT_BIG(*) AS cnt FROM ${fullName(schema, table)}`);
    ({ minV: min, maxV: max } = r.recordset[0]);
    rowCount = Number(r.recordset[0].cnt);
  }

  const parents = await getDependencyOrder(conn, target, schema, table);
  return { schema, table, columns: columns.map((c) => ({ name: c.name, type: c.type })), primaryKey: pk, parents, ...range, min, max, rowCount };
}

// ---------- DDL ----------

function typeDDL(c) {
  switch (c.type) {
    case 'char':
    case 'varchar':
    case 'binary':
    case 'varbinary':
      return `${c.type}(${c.maxLength === -1 ? 'max' : c.maxLength})`;
    case 'nchar':
    case 'nvarchar':
      return `${c.type}(${c.maxLength === -1 ? 'max' : c.maxLength / 2})`;
    case 'decimal':
    case 'numeric':
      return `${c.type}(${c.precision},${c.scale})`;
    case 'datetime2':
    case 'datetimeoffset':
    case 'time':
      return `${c.type}(${c.scale})`;
    case 'float':
      return c.precision === 53 ? 'float' : `float(${c.precision})`;
    default:
      return c.type;
  }
}

// forAdd: column is being added to an existing table, so it must be nullable and can't be an identity.
function columnDDL(c, forAdd) {
  if (c.isComputed) return `${q(c.name)} AS ${c.computedDefinition}${c.isPersisted ? ' PERSISTED' : ''}`;
  let s = `${q(c.name)} ${typeDDL(c)}`;
  if (c.collation) s += ` COLLATE ${c.collation}`;
  if (c.isIdentity && !forAdd) s += ` IDENTITY(${c.seed ?? 1},${c.increment ?? 1})`;
  if (c.defaultDefinition && !c.isIdentity) s += ` DEFAULT ${c.defaultDefinition}`;
  s += forAdd || c.isNullable ? ' NULL' : ' NOT NULL';
  return s;
}

async function ensureSchema(pool, schema) {
  await pool
    .request()
    .input('schema', sql.NVarChar, schema)
    .query(`IF SCHEMA_ID(@schema) IS NULL EXEC('CREATE SCHEMA ' + QUOTENAME(@schema))`);
}

async function createTable(pool, schema, table, columns, pk, warnings) {
  const build = (cols) => {
    const defs = cols.map((c) => columnDDL(c, false));
    if (pk.length) defs.push(`PRIMARY KEY (${pk.map(q).join(', ')})`);
    return `CREATE TABLE ${fullName(schema, table)} (\n  ${defs.join(',\n  ')}\n)`;
  };
  try {
    await pool.request().batch(build(columns));
  } catch (err) {
    // Computed columns can reference functions that don't exist in the target; retry without them.
    if (!columns.some((c) => c.isComputed)) throw err;
    await pool.request().batch(build(columns.filter((c) => !c.isComputed)));
    warnings.push(`Created without computed columns (${err.message})`);
  }
}

// ---------- data transfer ----------

// How each source column is read: values that would lose precision as JS numbers/Dates
// are converted to strings, and SQL Server converts them back when inserting into the stage table.
function selectExpr(c) {
  const col = q(c.name);
  switch (c.type) {
    case 'bigint':
    case 'decimal':
    case 'numeric':
      return `CONVERT(varchar(64), ${col}) AS ${col}`;
    case 'money':
    case 'smallmoney':
      return `CONVERT(varchar(64), ${col}, 2) AS ${col}`;
    case 'datetime':
    case 'smalldatetime':
      return `CONVERT(varchar(40), ${col}, 126) AS ${col}`;
    case 'date':
    case 'time':
    case 'datetime2':
    case 'datetimeoffset':
      return `CONVERT(varchar(40), ${col}) AS ${col}`;
    case 'geography':
    case 'geometry':
    case 'hierarchyid':
      return `CAST(${col} AS varbinary(max)) AS ${col}`;
    case 'sql_variant':
      return `CAST(${col} AS nvarchar(4000)) AS ${col}`;
    default:
      return col;
  }
}

function paramType(c) {
  switch (c.type) {
    case 'bigint':
    case 'decimal':
    case 'numeric':
    case 'money':
    case 'smallmoney':
    case 'datetime':
    case 'smalldatetime':
    case 'date':
    case 'time':
    case 'datetime2':
    case 'datetimeoffset':
      return sql.VarChar(64);
    case 'tinyint':
    case 'smallint':
    case 'int':
      return sql.Int;
    case 'bit':
      return sql.Bit;
    case 'float':
    case 'real':
      return sql.Float;
    case 'uniqueidentifier':
      return sql.UniqueIdentifier;
    case 'binary':
    case 'varbinary':
    case 'image':
    case 'geography':
    case 'geometry':
    case 'hierarchyid':
      return sql.VarBinary(sql.MAX);
    default:
      return sql.NVarChar(sql.MAX);
  }
}

// Streams a query's rows in batches, pausing the source while each batch is written.
function streamBatches(request, text, onBatch) {
  return new Promise((resolve, reject) => {
    let buffer = [];
    let chain = Promise.resolve();
    let error = null;
    let settled = false;
    const finish = () => {
      chain.then(() => {
        if (settled) return;
        settled = true;
        error ? reject(error) : resolve();
      });
    };
    const enqueue = (rows) => {
      chain = chain
        .then(() => (error ? undefined : onBatch(rows)))
        .catch((err) => {
          error ??= err;
          try {
            request.cancel();
          } catch {}
        });
    };

    request.stream = true;
    request.on('row', (row) => {
      buffer.push(row);
      if (buffer.length >= STREAM_BATCH) {
        const rows = buffer;
        buffer = [];
        request.pause();
        enqueue(rows);
        chain.then(() => !error && request.resume());
      }
    });
    request.on('error', (err) => {
      error ??= err;
      finish();
    });
    request.on('done', () => {
      if (buffer.length) enqueue(buffer);
      buffer = [];
      finish();
    });
    request.query(text);
  });
}

export async function syncTable({ source, target, schema, table, range = {} }, emit = () => {}) {
  const started = Date.now();
  const log = (message) => emit({ type: 'log', message });
  const name = fullName(schema, table);
  const result = {
    table: `${schema}.${table}`,
    created: false,
    columnsAdded: [],
    warnings: [],
    keyColumns: [],
    rowsRead: 0,
    rowsInserted: 0,
    rowsUpdated: 0,
  };

  const src = await getPool(source);
  const dst = await getPool(target);

  const srcCols = await getColumns(src, schema, table);
  if (!srcCols.length) throw new Error(`Table ${schema}.${table} not found in DB1`);
  const srcPk = await getPrimaryKey(src, schema, table);
  const rangeCol = pickRangeColumn(srcCols, srcPk);

  // 1. Schema: create the table, or add the columns it is missing.
  let dstCols = await getColumns(dst, schema, table);
  let dstPk = [];
  if (!dstCols.length) {
    log(`Table does not exist in DB2 — creating ${name}`);
    await ensureSchema(dst, schema);
    await createTable(dst, schema, table, srcCols, srcPk, result.warnings);
    result.created = true;
  } else {
    dstPk = await getPrimaryKey(dst, schema, table);
    const have = new Set(dstCols.map((c) => lower(c.name)));
    const missing = srcCols.filter((c) => !have.has(lower(c.name)));
    const hasRowversion = dstCols.some((c) => NOT_INSERTABLE.has(c.type));
    // Regular columns first so computed columns can reference them.
    for (const c of [...missing.filter((c) => !c.isComputed), ...missing.filter((c) => c.isComputed)]) {
      if (NOT_INSERTABLE.has(c.type) && hasRowversion) {
        result.warnings.push(`Skipped ${c.name}: DB2 table already has a rowversion column`);
        continue;
      }
      try {
        await dst.request().batch(`ALTER TABLE ${name} ADD ${columnDDL(c, true)}`);
        result.columnsAdded.push(c.name);
        log(`Added column ${c.name} ${typeDDL(c)}`);
      } catch (err) {
        if (!c.isComputed) throw new Error(`Could not add column ${c.name}: ${err.message}`);
        result.warnings.push(`Skipped computed column ${c.name}: ${err.message}`);
      }
    }
    if (!missing.length) log('Columns already match');
  }
  dstCols = await getColumns(dst, schema, table);
  if (result.created) dstPk = await getPrimaryKey(dst, schema, table);

  // 2. Work out which columns to copy and how to match rows.
  const dstByName = new Map(dstCols.map((c) => [lower(c.name), c]));
  const pairs = srcCols
    .filter((c) => !c.isComputed && !NOT_INSERTABLE.has(c.type))
    .map((c) => ({ src: c, dst: dstByName.get(lower(c.name)) }))
    .filter((p) => p.dst && !p.dst.isComputed && !NOT_INSERTABLE.has(p.dst.type));
  if (!pairs.length) throw new Error('No copyable columns');

  const pairByName = new Map(pairs.map((p) => [lower(p.src.name), p]));
  const added = new Set(result.columnsAdded.map(lower));
  const usableKey = (cols) =>
    cols.length > 0 &&
    cols.every((n) => {
      const p = pairByName.get(lower(n));
      return p && !NON_COMPARABLE.has(p.dst.type) && !added.has(lower(n));
    });
  const identity = srcCols.find((c) => c.isIdentity);
  const idNamed = srcCols.find((c) => lower(c.name) === 'id');
  let keys = [dstPk, srcPk, identity ? [identity.name] : [], idNamed ? [idNamed.name] : []].find(usableKey);
  let nullSafe = false;
  if (!keys) {
    keys = pairs.map((p) => p.src.name).filter((n) => usableKey([n]));
    nullSafe = true;
    if (!keys.length) throw new Error('Cannot determine how to match rows (no key or comparable columns)');
    result.warnings.push('No primary key/Id found — rows are matched by comparing all columns');
  }
  const keyDst = keys.map((n) => pairByName.get(lower(n)).dst.name);
  result.keyColumns = keyDst;
  log(`Matching rows on: ${keyDst.join(', ')}`);

  const keyJoin = keyDst
    .map((k) => (nullSafe ? `(t.${q(k)} = s.${q(k)} OR (t.${q(k)} IS NULL AND s.${q(k)} IS NULL))` : `t.${q(k)} = s.${q(k)}`))
    .join(' AND ');
  const backfill = pairs.filter((p) => added.has(lower(p.dst.name)));
  const colList = pairs.map((p) => q(p.dst.name)).join(', ');
  const needsIdentityInsert = pairs.some((p) => p.dst.isIdentity);
  const rowsPerInsert = Math.max(1, Math.min(1000, Math.floor(MAX_PARAMS / pairs.length)));

  // 3. Source query, newest first.
  const srcReq = src.request();
  const where = [];
  if (rangeCol.mode === 'date') {
    const col = q(rangeCol.column);
    if (range.from) {
      srcReq.input('from', sql.VarChar(10), range.from);
      where.push(`${col} >= CAST(@from AS datetime2)`);
    }
    if (range.to) {
      srcReq.input('to', sql.VarChar(10), range.to);
      where.push(`${col} < DATEADD(day, 1, CAST(@to AS datetime2))`);
    }
  } else if (rangeCol.mode === 'id') {
    const col = q(rangeCol.column);
    if (range.from !== undefined && range.from !== '') {
      srcReq.input('from', sql.VarChar(40), String(range.from));
      where.push(`${col} >= CAST(@from AS decimal(38,0))`);
    }
    if (range.to !== undefined && range.to !== '') {
      srcReq.input('to', sql.VarChar(40), String(range.to));
      where.push(`${col} <= CAST(@to AS decimal(38,0))`);
    }
  }
  const srcQuery =
    `SELECT ${pairs.map((p) => selectExpr(p.src)).join(', ')} FROM ${name}` +
    (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
    (rangeCol.column ? ` ORDER BY ${q(rangeCol.column)} DESC` : '');
  log(
    rangeCol.mode === 'all'
      ? 'No dateAdded/Id column — reading all rows'
      : `Reading rows by ${rangeCol.column} from ${range.to || 'latest'} down to ${range.from || 'oldest'}`
  );

  // 4. Copy: each batch goes into a temp stage table, then only missing rows are inserted.
  const tx = new sql.Transaction(dst);
  await tx.begin();
  let identityOn = false;
  try {
    await new sql.Request(tx).batch(`
      IF OBJECT_ID('tempdb..${STAGE}') IS NOT NULL DROP TABLE ${STAGE};
      SELECT TOP 0 ${colList} INTO ${STAGE} FROM ${name}
      UNION ALL SELECT TOP 0 ${colList} FROM ${name};`); // UNION drops the IDENTITY property
    if (needsIdentityInsert) {
      await new sql.Request(tx).batch(`SET IDENTITY_INSERT ${name} ON`);
      identityOn = true;
    }

    await streamBatches(srcReq, srcQuery, async (rows) => {
      await new sql.Request(tx).batch(`TRUNCATE TABLE ${STAGE}`);
      for (let i = 0; i < rows.length; i += rowsPerInsert) {
        const req = new sql.Request(tx);
        const values = rows.slice(i, i + rowsPerInsert).map((row, r) => {
          const ph = pairs.map((p, c) => {
            const param = `r${r}c${c}`;
            req.input(param, paramType(p.src), row[p.src.name]);
            return CLR_TYPES.has(p.src.type) ? `CAST(@${param} AS ${p.src.type})` : `@${param}`;
          });
          return `(${ph.join(', ')})`;
        });
        await req.query(`INSERT INTO ${STAGE} (${colList}) VALUES ${values.join(', ')}`);
      }

      if (backfill.length) {
        const r = await new sql.Request(tx).query(
          `UPDATE t SET ${backfill.map((p) => `t.${q(p.dst.name)} = s.${q(p.dst.name)}`).join(', ')}
           FROM ${name} t JOIN ${STAGE} s ON ${keyJoin}`
        );
        result.rowsUpdated += r.rowsAffected.reduce((a, b) => a + b, 0);
      }
      const r = await new sql.Request(tx).query(
        `INSERT INTO ${name} (${colList})
         SELECT ${pairs.map((p) => `s.${q(p.dst.name)}`).join(', ')} FROM ${STAGE} s
         WHERE NOT EXISTS (SELECT 1 FROM ${name} t WHERE ${keyJoin})`
      );
      result.rowsInserted += r.rowsAffected.reduce((a, b) => a + b, 0);
      result.rowsRead += rows.length;
      emit({ type: 'progress', table: result.table, rowsRead: result.rowsRead, rowsInserted: result.rowsInserted, rowsUpdated: result.rowsUpdated });
    });

    if (identityOn) await new sql.Request(tx).batch(`SET IDENTITY_INSERT ${name} OFF`);
    identityOn = false;
    await new sql.Request(tx).batch(`DROP TABLE ${STAGE}`);
    await tx.commit();
  } catch (err) {
    // IDENTITY_INSERT is a session setting and survives rollback, so reset it before the connection goes back to the pool.
    if (identityOn) {
      try {
        await new sql.Request(tx).batch(`SET IDENTITY_INSERT ${name} OFF`);
      } catch {}
    }
    try {
      await tx.rollback();
    } catch {}
    if (err.number === 547) {
      throw new Error(
        `${err.message} — some rows reference data that isn't in DB2 yet. Enable "Sync parent tables first", or sync the referenced table before this one.`
      );
    }
    throw err;
  }

  result.durationMs = Date.now() - started;
  return result;
}

// Syncs the tables this one references (all rows, missing ones only) before the table itself,
// so foreign keys in DB2 are satisfied.
export async function syncWithParents({ includeParents, ...opts }, emit = () => {}) {
  const parents = [];
  if (includeParents) {
    const src = await getPool(opts.source);
    for (const p of await getDependencyOrder(opts.source, opts.target, opts.schema, opts.table)) {
      const name = `${p.schema}.${p.table}`;
      if (!(await getColumns(src, p.schema, p.table)).length) {
        emit({ type: 'log', message: `Skipping parent ${name}: not found in DB1` });
        continue;
      }
      emit({ type: 'log', message: `— Syncing parent table ${name} (all rows) —` });
      parents.push(await syncTable({ ...opts, schema: p.schema, table: p.table, range: {} }, emit));
    }
    if (parents.length) emit({ type: 'log', message: `— Syncing ${opts.schema}.${opts.table} —` });
  }
  const result = await syncTable(opts, emit);
  return { ...result, parents };
}
