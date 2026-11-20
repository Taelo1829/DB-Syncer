export default function ConnectionForm({ title, conn, onChange, onConnect, status }) {
  const set = (key) => (e) =>
    onChange({ ...conn, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  const submit = (e) => {
    e.preventDefault();
    onConnect();
  };

  return (
    <form className="card conn" onSubmit={submit}>
      <div className="card-head">
        <h2>{title}</h2>
        {status.connected && <span className="badge ok">Connected</span>}
      </div>
      <div className="grid">
        <label>
          Server
          <input value={conn.server} onChange={set('server')} placeholder="localhost or HOST\INSTANCE" required />
        </label>
        <label>
          Port
          <input value={conn.port} onChange={set('port')} placeholder="1433" inputMode="numeric" />
        </label>
        <label>
          Database
          <input value={conn.database} onChange={set('database')} required />
        </label>
        <label>
          User
          <input value={conn.user} onChange={set('user')} autoComplete="username" />
        </label>
        <label>
          Password
          <input type="password" value={conn.password} onChange={set('password')} autoComplete="current-password" />
        </label>
      </div>
      <div className="checks">
        <label>
          <input type="checkbox" checked={conn.encrypt} onChange={set('encrypt')} /> Encrypt
        </label>
        <label>
          <input type="checkbox" checked={conn.trustServerCertificate} onChange={set('trustServerCertificate')} /> Trust
          server certificate
        </label>
      </div>
      <div className="row">
        <button type="submit" disabled={status.loading}>
          {status.loading ? 'Connecting…' : status.connected ? 'Reconnect' : 'Connect'}
        </button>
        {status.error && <span className="error">{status.error}</span>}
        {status.connected && status.info && (
          <span className="muted">
            {status.info.database} · SQL Server {status.info.version}
          </span>
        )}
      </div>
    </form>
  );
}
