# TAWZOON — Final Critical Financial Integrity Fix

Implementation plan to guarantee 100% data consistency, durable error recovery for Cloud Firestore sync failures, and database-level duplicate transaction prevention across multiple instances.

## Confirmed Decisions & Scope

- **Scope Boundary**: Fix only Financial Wallet Persistence, Firestore Sync Failure Recovery, and Duplicate Transaction Prevention across the 4 key wallet endpoints.
- **Safety Constraints**: No modifications to existing reseller wallet balances, referral bonus formulas, reseller margins, product pricing, UI design, or routing.
- **Backup**: Physical backup verified at `/app/applet/server.ts.wallet_backup` and database state store backup at `data/store.backup.json`.

---

## 1. Overview & Core Concept

Currently, when Cloud Firestore writes fail during a financial operation (e.g. network glitch or rate limit), `db.syncEntityDirect` logs the error internally without rethrowing. The caller endpoint assumes Cloud sync succeeded and returns `success: true`. Furthermore, if a user or network retries a financial request (such as a double-clicked withdrawal or sales approval), there is no persistent idempotency key guard checking if that exact request was already processed.

This fix introduces:
1. **Transactional Sync Outbox Queue**: Failed Cloud writes during financial operations are saved to a durable `syncOutboxQueue` inside `store.json` and Firestore, with automatic background retry handling until Cloud synchronization is confirmed.
2. **Persistent Idempotency Guard**: Every financial request checks a persistent `idempotencyKeys` store (in local state and Firestore) before executing balance mutations. Duplicate requests return the cached previous response without re-crediting or re-deducting funds.

---

## 2. Technical Architecture & System Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Financial API Endpoint                           │
│ (POST /withdrawals, PATCH /sales/:id/approve, PATCH /sales/:id/reject,  │
│                   PATCH /withdrawals/:id/process)                       │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │
                  1. Check Idempotency Key Guard
                                     │
             ┌───────────────────────┴───────────────────────┐
             │ Key Already Exists?                           │
             ├───────────────────────┬───────────────────────┤
             │ YES                   │ NO                    │
             ▼                       ▼                       │
    Return Cached Result    Acquire Employee Mutex Lock      │
    (Prevent Double Credit)          │                       │
                                     │                       │
                            2. Execute Balance &             │
                               Ledger Mutation               │
                                     │                       │
                            3. Save to Local File            │
                               (db.save())                   │
                                     │                       │
                            4. Await Cloud Sync              │
                                     │                       │
             ┌───────────────────────┴───────────────────────┐
             │ Cloud Sync Status?                            │
             ├───────────────────────┬───────────────────────┤
             │ SUCCESS               │ FAILURE / OFFLINE     │
             ▼                       ▼                       │
    Store Idempotency Key   Enqueue in Durable Outbox Queue │
    Return HTTP 200          Store Idempotency Key           │
                            Return HTTP 200 with Sync Note  │
                                     │                       │
                                     ▼                       │
                            Background Worker Retries        │
                            Outbox Queue to Firestore        │
```

---

## 3. Detailed Component Plan

### A. Database Engine Enhancements (`server/db.ts`)
1. **Durable Outbox Queue (`syncOutboxQueue`)**:
   - Add `syncOutboxQueue: OutboxItem[]` to `DatabaseState` interface.
   - When `syncEntityDirect` fails or encounters network errors, add the item to `syncOutboxQueue` and persist it in `store.json`.
   - Add `processSyncOutbox()` method that runs on server boot and periodically (every 30s) to flush pending outbox items to Cloud Firestore.

2. **Persistent Idempotency Store (`idempotencyKeys`)**:
   - Add `idempotencyKeys: Record<string, IdempotencyRecord>` to `DatabaseState`.
   - Add helper methods `db.hasIdempotencyKey(key)` and `db.setIdempotencyKey(key, responseData)`.
   - Idempotency records are synced to Firestore collection `_idempotency_keys` so multiple container instances share the duplicate guard.

3. **Strict Sync Mode for `syncEntityDirect`**:
   - Add optional parameter `throwOnError?: boolean` to `syncEntityDirect`. When set to `true` in financial endpoints, errors are thrown to the caller to trigger outbox queuing and audit logging.

---

### B. Wallet-Critical Endpoint Refactor (`server.ts`)

#### 1. `POST /api/employee/withdrawals`
- Generate unique idempotency key: `wdr_req:${reqEmp.id}:${amount}:${paymentMethod}:${accountNumber}` or `req.headers['x-idempotency-key']`.
- If idempotency key exists, return cached result immediately.
- Execute balance deduction inside `mutex.runExclusive`.
- Attempt `Promise.all` cloud sync. If Cloud write fails, enqueue into `syncOutboxQueue`, mark idempotency key as `QUEUED`, save local store, and return clean response indicating local processing succeeded and cloud sync is queued.

#### 2. `PATCH /api/admin/sales/:id/approve`
- Generate idempotency key: `sale_approve:${saleId}`.
- If already approved/processed according to idempotency key or sale status, return 409 or cached response.
- Mutex lock employee & upline referral accounts.
- Perform commission & bonus calculation.
- Save local store, await cloud sync, and push to `syncOutboxQueue` on sync failure.

#### 3. `PATCH /api/admin/sales/:id/reject`
- Generate idempotency key: `sale_reject:${saleId}`.
- If already rejected, return 409 or cached result.
- Mutex lock & reverse profits/commissions safely.
- Save local store, await cloud sync with outbox fallback.

#### 4. `PATCH /api/admin/withdrawals/:id/process`
- Generate idempotency key: `wdr_process:${withdrawalId}:${action}`.
- If withdrawal is already `APPROVED` or `REJECTED`, reject duplicate request.
- Mutex lock employee account, process payout or refund.
- Save local store, await cloud sync with outbox fallback.

---

## 4. Verification & Testing Strategy

In our isolated test environment, we will verify:
1. **Firestore Write Failure**: Simulate offline/failing Firestore writes during withdrawal request and verify item lands in `syncOutboxQueue` in `store.json`.
2. **Outbox Recovery**: Trigger `db.processSyncOutbox()` when Firestore is reachable and verify outbox items flush to Firestore.
3. **Duplicate Request Prevention**: Send duplicate `POST /api/employee/withdrawals` and `PATCH /api/admin/sales/:id/approve` with the same idempotency key, confirming only one execution occurs.
4. **Server Restart Persistence**: Restart server and confirm balance, ledger, outbox queue, and idempotency records remain intact.
5. **Build & Lint Verification**: Run `lint_applet` (`tsc --noEmit`) and `compile_applet` to confirm zero compilation errors.
