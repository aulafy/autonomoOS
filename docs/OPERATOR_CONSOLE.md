# Operator console prototype

The Three.js client shows a read-only control-plane panel beside Astra. It
requests `control.snapshot` over the loopback WebSocket every two seconds.
The runtime builds that snapshot from SQLite-restored effect, budget,
observation, reconciliation, task, and runtime-event stores. Indexed SQLite
queries load up to 100 recent events per displayed task and 20 recent denials,
instead of deserializing the entire runtime journal on each refresh. A browser refresh
therefore reconstructs the view from durable facts.

The runtime journal section retains its SQLite event order. It can show a
model's inference request, plan proposal, action proposal, C11 admission,
commit-gate pass, and dispatch reports. The effect header, budget status,
independent observations, and C7 reconciliation decisions come from their
authoritative stores. A separate list shows recent denials even when no effect
was created.

Each effect has a **Browse event history** button. It requests up to 30 raw journal
rows at a time, ordered by SQLite sequence. **Older events** uses an exclusive
sequence cursor, so identical timestamps do not duplicate or skip entries.
The server resolves the effect before querying its task and intent, then sends
only the narrow event projection used by the summary card. Pages replace one
another in this prototype.

The snapshot explicitly selects fields. It excludes goals, prompts, action
parameters, provider bodies, credentials, raw metadata, and arbitrary denial
text. Only known denial codes and verdicts are displayed. The panel is an
operator aid, not an authority source: changing its display cannot authorize
or settle an action.

Run `npm run dev:runtime` and `npm run dev:world`, then open the Vite URL. If
8787 is in use, start the runtime with `AGENT_RUNTIME_PORT=8799` and append
`?runtimePort=8799` to the Vite URL. The runtime listens on loopback only.

This prototype keeps up to 20 recent effects in the panel. The summary card
shows the latest 30 eligible entries from the most recent 100 task events;
the full journal is cursor-paginated. A larger deployment needs task filters,
page navigation, and authenticated operator access before exposing this view
beyond a local development machine.
