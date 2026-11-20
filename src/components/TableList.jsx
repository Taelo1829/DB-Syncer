import { useMemo, useState } from 'react';

export default function TableList({ tables, targetTables, targetConnected, onSync, onRefresh, loading }) {
  const [filter, setFilter] = useState('');

  const visible = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return f ? tables.filter((t) => `${t.schema}.${t.table}`.toLowerCase().includes(f)) : tables;
  }, [tables, filter]);

  return (
    <section className="card">
      <div className="card-head">
        <h2>
          DB1 tables <span className="muted">({tables.length})</span>
        </h2>
        <div className="row">
          <input className="filter" placeholder="Filter tables…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <button className="secondary" onClick={onRefresh} disabled={loading}>
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>
      {!targetConnected && <p className="notice">Connect DB2 to enable syncing.</p>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Table</th>
              <th className="num">Rows</th>
              <th>Range by</th>
              <th>In DB2</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {visible.map((t) => {
              const key = `${t.schema}.${t.table}`;
              const targetRows = targetTables.get(key.toLowerCase());
              return (
                <tr key={key}>
                  <td>
                    <span className="muted">{t.schema}.</span>
                    {t.table}
                  </td>
                  <td className="num">{t.rowCount.toLocaleString()}</td>
                  <td>{t.dateColumn ? <span className="badge">{t.dateColumn}</span> : <span className="badge dim">Id</span>}</td>
                  <td>
                    {targetConnected ? <TargetBadge sourceRows={t.rowCount} targetRows={targetRows} /> : <span className="muted">—</span>}
                  </td>
                  <td className="actions">
                    <button onClick={() => onSync(t)} disabled={!targetConnected}>
                      Sync
                    </button>
                  </td>
                </tr>
              );
            })}
            {!visible.length && (
              <tr>
                <td colSpan={5} className="muted center">
                  No tables
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TargetBadge({ sourceRows, targetRows }) {
  if (targetRows === undefined) return <span className="badge warn">New</span>;
  if (targetRows === sourceRows) return <span className="badge ok">Synced</span>;
  if (targetRows < sourceRows) {
    return (
      <span className="badge partial" title={`DB2 has ${targetRows.toLocaleString()} rows`}>
        {(sourceRows - targetRows).toLocaleString()} behind
      </span>
    );
  }
  return (
    <span className="badge dim" title={`DB2 has ${targetRows.toLocaleString()} rows`}>
      Exists (+{(targetRows - sourceRows).toLocaleString()})
    </span>
  );
}
