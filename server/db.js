import sql from 'mssql';

const pools = new Map();

// Turns the connection form values into an mssql config.
// "HOST\INSTANCE" is split into server + instanceName (port is ignored for named instances).
export function toConfig(conn) {
  if (!conn?.server || !conn?.database) throw new Error('Server and database are required');
  let server = conn.server.trim();
  let instanceName;
  if (server.includes('\\')) [server, instanceName] = server.split('\\');

  return {
    server,
    port: !instanceName && conn.port ? Number(conn.port) : undefined,
    database: conn.database.trim(),
    user: conn.user,
    password: conn.password,
    requestTimeout: 0, // large tables can take a while
    connectionTimeout: 15000,
    pool: { max: 5, min: 0, idleTimeoutMillis: 60000 },
    options: {
      encrypt: !!conn.encrypt,
      trustServerCertificate: !!conn.trustServerCertificate,
      instanceName,
    },
  };
}

export async function getPool(conn) {
  const config = toConfig(conn);
  const key = JSON.stringify(config);
  let entry = pools.get(key);
  if (!entry) {
    const pool = new sql.ConnectionPool(config);
    pool.on('error', () => pools.delete(key));
    entry = pool.connect().catch((err) => {
      pools.delete(key);
      throw err;
    });
    pools.set(key, entry);
  }
  return entry;
}

export async function closeAll() {
  for (const entry of pools.values()) {
    try {
      (await entry).close();
    } catch {}
  }
  pools.clear();
}
