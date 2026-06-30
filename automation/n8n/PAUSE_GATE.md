# Honoring the dashboard's "Pause automation" toggle

> ✅ **Already applied to the live n8n server** on 2026-06-30 — implemented inside
> the `Set Delay` node (it returns early when `automation_paused` is true), so no
> extra IF node was needed. The dashboard toggle now actually stops replies on the
> next inbound DM (the message is still logged). The IF-node approach below is an
> alternative for anyone re-importing the workflow from scratch.

The admin dashboard can pause/resume a bot's auto-replies. It sets
`bots.automation_paused` (via the `set_automation_paused` RPC). The flag is now
also returned by `dm_ingest` as `automation_paused`, so the n8n flow can gate on
it with a single node — **no other changes needed**.

## Add one IF node to `candace_manychat_async.json`

1. Open the **`DB: ingest`** node (the Supabase RPC call to `dm_ingest`). It already
   returns the context object; that object now includes `automation_paused`.
2. Immediately **after** `DB: ingest`, insert an **IF** node named **`Paused?`**:
   - Condition (Boolean): `{{ $json.automation_paused }}` **is true**
   - **true** branch → leave unconnected (dead-ends: no reply is generated/sent).
   - **false** branch → wire to whatever currently follows `DB: ingest`
     (the `Set Delay` / classify chain).
3. Save and re-import/activate the workflow.

That's it. When the dashboard toggles a bot to paused, inbound DMs are still logged
(so the queue/transcripts stay complete) but no reply is generated or sent. Resuming
flips the flag back and replies continue on the next message.

Until this node is added, the dashboard toggle is **advisory** — it records the
intent and shows the paused state, but the live flow keeps replying.
