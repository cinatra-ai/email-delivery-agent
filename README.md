# Email Delivery Agent

The final send step of an outreach campaign. Connect your Gmail account in workspace settings and install this agent from the marketplace, then invoke it (directly or from an orchestrating agent such as the Email Outreach Agent) with an approved draft bundle, a confirmed recipient list, a campaign ID, and the sender email address. The agent calls the email provider API, watches the batch to completion, and returns a structured delivery summary. All sends route through the platform send pipeline; when dev-mode redirect is configured, outgoing messages are redirected to the override recipient instead of the real addressees.

## Works with

- Gmail — connect via the Gmail integration in workspace settings (OAuth; the sender address must be a mailbox the connected account is authorised to send from)

## Capabilities

- Send an approved outreach campaign through your connected email provider
- Accept four required inputs: campaign ID (UUID), approved draft bundle reference (UUID), confirmed recipients reference (UUID), and sender email address
- Poll the send operation to completion and surface a structured delivery summary with total sent, total failed, and an operation ID
- Route every message through the workspace send pipeline, which applies the dev-mode redirect at the bridge layer when configured
- Return a machine-readable send result object for the calling orchestrator or for display in the Human-in-the-Loop send confirmation screen
- Fail fast with a structured error code when object resolution fails (OBJECTS_FETCH_FAILED) or the poll budget is exhausted (POLL_BUDGET_EXHAUSTED)
