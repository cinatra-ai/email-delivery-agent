# Email Delivery Agent

The final send step of an outreach campaign. Connect your Gmail account in workspace settings and install this agent from the marketplace, then invoke it (directly or from an orchestrating agent such as the Email Outreach Agent) with an approved draft bundle, a confirmed recipient list, a campaign ID, and the sender email address. After you decide on the send on the application's publish card, the agent starts the send with exactly the values the card showed and returns the send's answer: its status, the counts of messages sent, skipped and in doubt and, on a failure, the reason. All sends route through the platform send pipeline; when dev-mode redirect is configured, outgoing messages are redirected to the override recipient instead of the real addressees.

## Works with

- Gmail — connect via the Gmail integration in workspace settings (OAuth; the sender address must be a mailbox the connected account is authorised to send from)
- A Cinatra host that serves `email_outreach_send_initial_start` to a publishing step on its passthrough road and takes `approvedBodies` as JSON text (cinatra-ai/cinatra#3089); on an older host the send call is refused, the run ends and no email is sent

## Capabilities

- Send an approved outreach campaign through your connected email provider, after you decide on the send on the application's publish card, which shows the sending mailbox, the recipients with the subject of each email, the emails and the call to action; the recipients are the real addressees, so with the dev-mode redirect on the card does not show the override recipient that gets the mail
- Ask only for the sender email address, its one required input, drawn with the Email Outreach Agent's sender picker when that agent is installed; the campaign ID, the approved draft bundle reference, the confirmed recipients reference and the values the publish card shows (the recipients, the email bodies and the call to action) are handed in by the orchestrating agent
- Start the send without a model step: its arguments are the run's own values, including the approved email bodies the card showed
- End with one plain sentence on how many messages went out or, on a failure, what stopped the send
- Route every message through the workspace send pipeline, which applies the dev-mode redirect at the bridge layer when configured
- Hand the calling orchestrator the send's status, its counts and the reason of a failure
