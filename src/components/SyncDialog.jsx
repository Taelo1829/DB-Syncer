import { useEffect, useRef, useState } from 'react';
import { post, runSync } from '../api.js';

export default function SyncDialog({ table, source, target, onClose, onSynced }) {
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [includeParents, setIncludeParents] = useState(true);
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState([]);
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null);
  const logRef = useRef(null);

  useEffect(() => {
    post('table-info', { conn: source, target, schema: table.schema, table: table.table })
      .then((data) => {
        setInfo(data);
        setFrom(data.min ?? '');
        setTo(data.max ?? '');
      })
      .catch((err) => setError(err.message));
  }, [table, source, target]);

  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight);
  }, [logs]);

  const start = async () => {
    setRunning(true);
    setError('');
    setLogs([]);
    setProgress(null);
    setResult(null);
    try {
      await runSync(
        { source, target, schema: table.schema, table: table.table, range: { from, to }, includeParents },
        (ev) => {
          if (ev.type === 'log') setLogs((l) => [...l, ev.message]);
          else if (ev.type === 'progress') setProgress(ev);
          else if (ev.type === 'done') {
            setResult(ev.result);
            onSynced();
          } else if (ev.type === 'error') setError(ev.error);
        }
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setRunning(false);
    }
  };

  const inputType = info?.mode === 'date' ? 'date' : 'number';

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && !running && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true">
        <div className="card-head">
          <h2>
            Sync {table.schema}.{table.table}
          </h2>
          <button className="ghost" onClick={onClose} disabled={running} aria-label="Close">
            ✕
          </button>
        </div>

        {!info && !error && <p className="muted">Reading table info…</p>}

        {info && (
          <>
            <p className="muted">
              {info.rowCount.toLocaleString()} rows in DB1 · {info.columns.length} columns
              {info.primaryKey.length > 0 && <> · PK: {info.primaryKey.join(', ')}</>}
            </p>

            {info.parents?.length > 0 && (
              <div className="parents">
                <label className="inline">
                  <input
                    type="checkbox"
                    checked={includeParents}
                    onChange={(e) => setIncludeParents(e.target.checked)}
                    disabled={running}
                  />
                  Sync parent tables first (all rows, new rows only)
                </label>
                <p className="muted small">
                  References via foreign keys: {info.parents.map((p) => `${p.schema}.${p.table}`).join(', ')}
                </p>
              </div>
            )}

            {info.mode === 'all' ? (
              <p className="notice">No dateAdded or Id column found — all rows will be compared and copied.</p>
            ) : (
              <>
                <p>
                  Range by <strong>{info.column}</strong> ({info.mode === 'date' ? 'date added' : 'Id'}), copied latest → oldest.
                </p>
                <div className="grid">
                  <label>
                    Latest (to)
                    <input type={inputType} value={to} onChange={(e) => setTo(e.target.value)} disabled={running} />
                  </label>
                  <label>
                    Oldest (from)
                    <input type={inputType} value={from} onChange={(e) => setFrom(e.target.value)} disabled={running} />
                  </label>
                </div>
                <p className="muted small">
                  Available: {info.min ?? '—'} → {info.max ?? '—'}. Leave a field empty for no limit.
                </p>
              </>
            )}
          </>
        )}

        {(logs.length > 0 || progress) && (
          <div className="log" ref={logRef}>
            {logs.map((l, i) => (
              <div key={i}>{l}</div>
            ))}
            {progress && (
              <div className="progress">
                {progress.table}: read {progress.rowsRead.toLocaleString()} · inserted {progress.rowsInserted.toLocaleString()}
                {progress.rowsUpdated > 0 && <> · backfilled {progress.rowsUpdated.toLocaleString()}</>}
              </div>
            )}
          </div>
        )}

        {result && (
          <div className="result">
            <strong>Done in {(result.durationMs / 1000).toFixed(1)}s</strong>
            <ul>
              {(result.parents ?? []).map((p) => (
                <li key={p.table}>
                  Parent {p.table}: {p.created ? 'created, ' : ''}
                  {p.rowsInserted.toLocaleString()} new rows
                  {p.columnsAdded.length > 0 && <>, added columns {p.columnsAdded.join(', ')}</>}
                </li>
              ))}
              {result.created && <li>Created table in DB2</li>}
              {result.columnsAdded.length > 0 && <li>Added columns: {result.columnsAdded.join(', ')}</li>}
              <li>Rows read from DB1: {result.rowsRead.toLocaleString()}</li>
              <li>New rows inserted into DB2: {result.rowsInserted.toLocaleString()}</li>
              {result.columnsAdded.length > 0 && <li>Existing rows backfilled: {result.rowsUpdated.toLocaleString()}</li>}
              <li>Matched on: {result.keyColumns.join(', ')}</li>
              {result.warnings.map((w, i) => (
                <li key={i} className="warn-text">
                  {w}
                </li>
              ))}
            </ul>
          </div>
        )}

        {error && <p className="error">{error}</p>}

        <div className="row end">
          <button className="secondary" onClick={onClose} disabled={running}>
            Close
          </button>
          <button onClick={start} disabled={!info || running}>
            {running ? 'Syncing…' : result ? 'Sync again' : 'Sync'}
          </button>
        </div>
      </div>
    </div>
  );
}
