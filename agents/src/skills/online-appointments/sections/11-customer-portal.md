## § Customer Portal

**Required for:** Class credits system (view credits, purchase packages)  
**Optional for:** Fixed/variable pricing (can work without accounts)

### 11.1 Account Page

**File: `src/pages/Account.tsx`** (Vite + React Router; register at `/account`. No
`'use client'` directive.)

```typescript
import { useEffect, useState } from 'react';
import { authClient } from '@/lib/auth/auth-client';

export default function AccountPage() {
  const [session, setSession] = useState(null);
  const [credits, setCredits] = useState(0);
  const [transactions, setTransactions] = useState([]);

  useEffect(() => {
    authClient.getSession().then(setSession);
    fetch('/api/account/credits')
      .then((res) => res.json())
      .then((data) => {
        setCredits(data.credits);
        setTransactions(data.transactions);
      });
  }, []);

  if (!session) return <p>Please sign in to view your account.</p>;

  return (
    <main className="account-page">
      <h1>My Account</h1>
      <div className="credits-summary">
        <h2>Available Credits: {credits}</h2>
        <a href="/credits/purchase">Buy More Credits</a>
      </div>

      <section>
        <h2>Credit History</h2>
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Type</th>
              <th>Amount</th>
              <th>Balance</th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((tx) => (
              <tr key={tx.id}>
                <td>{new Date(tx.createdAt).toLocaleDateString()}</td>
                <td>{tx.type}</td>
                <td>{tx.amount > 0 ? `+${tx.amount}` : tx.amount}</td>
                <td>{tx.balanceAfter}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
```

### 11.2 Credits API

**File: `src/server/api/account/credits/GET.ts`**

Assumes you've added a `credits` column to the Better Auth `user` table and a `creditTransactions`
table during database setup.

```typescript
import type { Request, Response } from 'express';
import { eq, desc } from 'drizzle-orm';
import { db } from '../../../db/client';
import { user, creditTransactions } from '../../../db/schema';
import { requireAuth } from '../../../middleware/auth';

export default async function handler(req: Request, res: Response) {
  await requireAuth(req, res);

  const userId = req.user.id;

  const rows = await db.select().from(user).where(eq(user.id, userId)).limit(1);

  if (rows.length === 0) {
    return res.status(404).json({ error: 'User not found' });
  }

  const transactions = await db
    .select()
    .from(creditTransactions)
    .where(eq(creditTransactions.userId, userId))
    .orderBy(desc(creditTransactions.createdAt));

  return res.json({
    credits: rows[0].credits,
    transactions,
  });
}
```
