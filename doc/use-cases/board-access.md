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

## Planned passkey access for My Ideas

Open **My Ideas** and use a saved passkey. On first use, verify your account through Cloudflare Access and set up a passkey. Progress can read your email from the verified token and use the verified account ID to keep private ideas accessible to their owner. Shared ideas stay on the shared board. [Cloudflare Access passkeys](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/passkeys/)
