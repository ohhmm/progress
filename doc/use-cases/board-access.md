# Board access use cases

Open Progress to work on a board or view a shared board. Progress uses any active session automatically.

| Use case | What happens |
| --- | --- |
| Edit the board | Choose **Open editor**. If the editor asks for the board password, enter it and choose **Open board**. An incorrect password shows an error and allows another attempt. |
| Return to the editor | Choose **Remember this browser for 30 days** on a trusted device to reopen the board without entering the password again. A temporary editor session uses a browser session cookie and expires within 12 hours. |
| View the shared board | On a deployment configured for shared viewing, choose **View shared board** and use an account allowed by the Cloudflare Access policy. The viewer opens the board in read-only mode, including item notes. |
| Open the editor from the viewer | Choose **New task** or **Edit**. The editor opens directly with an active editor session or asks for the board password. |

Editor sessions apply to one browser and deployment origin. An expired session, a different device or deployment, or a changed board password can trigger a new password prompt.

API clients can use HTTP Basic Auth over HTTPS with the username `taskflow` and the deployment’s board password. The web editor can use its session cookie. API writes require an `Origin` matching the deployment origin.

For deployment setup, see [Configure viewer access](../../README.md#configure-viewer-access).

## Passkey sign-in on the dashboard

Open the existing Progress dashboard and browse its default content, including sample items when a preview is shown. Opening the dashboard and browsing it require no passkey prompt. Use blue accents and clearly label sample content.

| Use case | What happens |
| --- | --- |
| Attempt a write | Adding, editing, moving, or deleting an item and changing categories all use the same sign-in flow. If a session is needed, pause the write and keep the user's draft or selected action. |
| Use a saved passkey | Explain why sign-in is needed and offer **Use a passkey**. After verification, return the user to the pending action. |
| Set up a passkey | From the same sign-in screen, offer **Create a passkey** for the first visit. Explain that the device will save a passkey for Progress before showing its prompt. After setup, return the user to the pending action. |
| The device finds no passkey | Show the same screen with a clear choice to create a passkey or try a device or password manager with an existing one. |
| Cancel or retry | Leave the dashboard and draft available. Apply the write only after successful sign-in and confirmation of any action that normally requires it. |
| Make another change | Reuse the active session. If it expires, the next write attempt opens the same flow. |

Progress identifies a passkey account with an internal ID. The passkey flow requires no email or social account. The dashboard checks write permission after sign-in and before applying any pending change.
