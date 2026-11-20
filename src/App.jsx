import { useEffect, useState } from 'react';
import { post } from './api.js';
import ConnectionForm from './components/ConnectionForm.jsx';
import TableList from './components/TableList.jsx';
import SyncDialog from './components/SyncDialog.jsx';

const EMPTY = { server: '', port: '1433', database: '', user: '', password: '', encrypt: false, trustServerCertificate: true };
const idle = { connected: false, loading: false, error: '', info: null };

// Connection details are remembered between visits, except the password.
function loadConn(key) {
  try {
    return { ...EMPTY, ...JSON.parse(localStorage.getItem(key) || '{}'), password: '' };
  } catch {
    return { ...EMPTY };
  }
}
function saveConn(key, conn) {
  try {
    const { password, ...rest } = conn;
    localStorage.setItem(key, JSON.stringify(rest));
  } catch {}
}

export default function App() {
  const [source, setSource] = useState(() => loadConn('dbsync.source'));
  const [target, setTarget] = useState(() => loadConn('dbsync.target'));
  const [sourceStatus, setSourceStatus] = useState(idle);
  const [targetStatus, setTargetStatus] = useState(idle);
  const [tables, setTables] = useState([]);
  const [targetTables, setTargetTables] = useState(new Map()); // "schema.table" -> row count
  const [loadingTables, setLoadingTables] = useState(false);
  const [syncing, setSyncing] = useState(null);

  useEffect(() => saveConn('dbsync.source', source), [source]);
  useEffect(() => saveConn('dbsync.target', target), [target]);

  const loadSourceTables = async (conn = source) => {
    setLoadingTables(true);
    try {
      setTables((await post('tables', { conn })).tables);
    } catch (err) {
      setSourceStatus((s) => ({ ...s, error: err.message }));
    } finally {
      setLoadingTables(false);
    }
  };

  const loadTargetTables = async (conn = target) => {
    try {
      const { tables } = await post('tables', { conn });
      setTargetTables(new Map(tables.map((t) => [`${t.schema}.${t.table}`.toLowerCase(), t.rowCount])));
    } catch (err) {
      setTargetStatus((s) => ({ ...s, error: err.message }));
    }
  };

  const connect = async (conn, setStatus, onConnected) => {
    setStatus({ ...idle, loading: true });
    try {
      const info = await post('connect', { conn });
      setStatus({ ...idle, connected: true, info });
      onConnected(conn);
    } catch (err) {
      setStatus({ ...idle, error: err.message });
    }
  };

  // Editing a connection invalidates it until the user connects again.
  const editSource = (c) => {
    setSource(c);
    if (sourceStatus.connected) setSourceStatus(idle);
  };
  const editTarget = (c) => {
    setTarget(c);
    if (targetStatus.connected) setTargetStatus(idle);
  };

  return (
    <div className="app">
      <header>
        <h1>DB Syncer</h1>
        <p className="muted">Copy table schema and data from DB1 to DB2 (SQL Server)</p>
      </header>

      <div className="conns">
        <ConnectionForm
          title="DB1 · Source"
          conn={source}
          onChange={editSource}
          status={sourceStatus}
          onConnect={() => connect(source, setSourceStatus, loadSourceTables)}
        />
        <ConnectionForm
          title="DB2 · Target"
          conn={target}
          onChange={editTarget}
          status={targetStatus}
          onConnect={() => connect(target, setTargetStatus, loadTargetTables)}
        />
      </div>

      {sourceStatus.connected && (
        <TableList
          tables={tables}
          targetTables={targetTables}
          targetConnected={targetStatus.connected}
          loading={loadingTables}
          onRefresh={() => {
            loadSourceTables();
            if (targetStatus.connected) loadTargetTables();
          }}
          onSync={setSyncing}
        />
      )}

      {syncing && (
        <SyncDialog
          table={syncing}
          source={source}
          target={target}
          onClose={() => setSyncing(null)}
          onSynced={() => loadTargetTables()}
        />
      )}
    </div>
  );
}
