import { test, expect } from '../../src/fixtures';

interface UserRow {
  id: number;
  email: string;
}

test('a freshly registered user is persisted in the Users table', async ({ user, db }) => {
  // The `user` fixture has already registered via POST /api/Users and the INSERT is
  // committed (rollback-journal mode) before this first query triggers the snapshot copy,
  // so the row is guaranteed present. Plain `=` (BINARY): fixture emails are lowercase and
  // stored verbatim -- COLLATE NOCASE would mask a real casing regression.
  const rows = db.query<UserRow>(
    'SELECT id, email FROM Users WHERE email = ?',
    user.email,
  );

  expect(rows).toHaveLength(1);
  expect(rows[0].email).toBe(user.email);
});
