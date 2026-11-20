# DB Syncer

Copies table schema and data from one SQL Server database (DB1) to another (DB2).

## Run

```bash
npm install
npm run dev        # API on :3101 + Vite UI on http://localhost:5173
```

Or build once and serve everything from the API: `npm run build && npm start` → http://127.0.0.1:3101

## How a sync works

1. **Range** – if the table has a `dateAdded` (or `date_added`) date column you pick a date range;
   otherwise an Id column (identity → single-column PK → column named `Id`) and you pick an Id range.
   Rows are read newest → oldest. Tables with neither are copied in full.
2. **Schema**
   - Table missing in DB2 → created with the same columns, types, identity, defaults, computed columns and primary key.
   - Table exists → any columns missing in DB2 are added (as nullable), and those new columns are
     backfilled for existing rows that match by key.
3. **Data** – rows in the range are streamed in batches into a temp table on DB2, then only rows
   that don't already exist are inserted. Rows are matched on the DB2 primary key, else DB1's PK,
   else the identity/Id column, else all comparable columns.
   Identity values are preserved (`IDENTITY_INSERT`). The data copy runs in one transaction and rolls back on error.

4. **Foreign keys** – tables referenced by foreign keys (in DB1 or DB2) are listed in the sync dialog.
   With "Sync parent tables first" on (default), those parents are synced first, all rows and
   missing rows only, in dependency order, so FK constraints in DB2 are satisfied.
   Foreign keys themselves are not copied when a table is created.

## Notes

- SQL Server authentication only (the `tedious` driver doesn't do Windows auth).
- For a named instance enter `HOST\INSTANCE` as the server (port is then ignored).
- Connection details (except the password) are remembered in the browser's localStorage.
- The API only listens on 127.0.0.1.
- Existing rows in DB2 are never deleted or overwritten — only new rows and new-column values are written.
