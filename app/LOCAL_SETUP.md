# Setting up the main app locally

Note: This setup submits tasks to Nomad and the agent and dev application runs on Nomad

### 1. Create .env.local with the following content

```
SSO_LOGIN_URL=https://sso.dev-godaddy.com/login
SSO_LOGOUT_URL=https://sso.dev-godaddy.com/logout
LOGIN_REDIRECT_URL=https://airo-builder.dev-godaddy.com/
LOGOUT_REDIRECT_URL=https://airo-builder.dev-godaddy.com/
NEXT_PUBLIC_AUTH_IN_DEV=false
AWS_REGION=eu-central-1
AWS_ACCOUNT_ID=418549769352
NODE_ENV=development
ALLOWED_ORIGINS_FOR_AGENTS=https://airo-builder.dev-godaddy.com,http://airo-builder.dev-godaddy.com,airo-builder.dev-godaddy.com,https://airo-builder.test-godaddy.com,http://airo-builder.test-godaddy.com,airo-builder.test-godaddy.com
ENVIRONMENT_NAME=development
NOMAD_SPEC_IMAGE_VERSION=local-dev-v1.0.0
# Add the following the connect to MYSQL
MYSQL_DB_PATH=""
MYSQL_DB_USERNAME=
MYSQL_DB_PORT=
MYSQL_DB_PASSWORD=""
MYSQL_DB_NAME=
```

Refer `env.example` for details

### 2. Setup localhost to point to airo-builder.dev-godaddy.com in /etc/hosts

Use any preferred editor to modify the `/etc/hosts` file and add the following line at the end of it.

```
127.0.0.1    airo-builder.dev-godaddy.com
```

Note: This will point `airo-builder.dev-godaddy.com` to your localhost, so if you want to access the actual application which is hosted in the cloud, ensure to delete the above mentioned entry from the `/etc/hosts`

For running local against an environment, you may need to configure CORS origins for agent communication:

```bash
# Add to your .env.local file
ALLOWED_ORIGINS_FOR_AGENTS={retrieve from katana secrets}
```

This environment variable allows the agent containers to communicate with your local development server and test environments.

The application supports two deployment modes:

- **Legacy Mode**: Uses local database + Nomad/SQS (default)
- **V2 Mode**: Uses mgmt-airo + mgmt-hosting APIs (test environment)

#### For Chrome

If you encounter CORS issues over VPN, make sure you disable the `local-network-access-check` flag at `chrome://flags` and restart Chrome.

#### Setting Up V2 Mode for Testing

1. **Create/Edit `.env`:**

```bash
# Enable V2 Control Plane
USE_V2_CONTROL_PLANE=true

# V2 requires test SSO environment (not dev)
SSO_LOGIN_URL=https://sso.test-godaddy.com/login
SSO_LOGOUT_URL=https://sso.test-godaddy.com/logout
LOGIN_REDIRECT_URL=https://airo-builder.test-godaddy.com/
LOGOUT_REDIRECT_URL=https://airo-builder.test-godaddy.com/

# mgmt-airo API Configuration
MGMT_AIRO_BASE_URL=https://mgmt.nstk.net

# Authentication mode
AUTH_TYPE=jwt
```

2. **Restart your development server:**

```bash
pnpm run dev:app
```

3. **Verify V2 Mode is Active:**
   - Create a new site - it should have `controlPlane: "v2"`
   - Check browser console for `control-plane.factory` logs
   - The Publish button should appear on `/develop` pages for V2 sites

#### Differences Between Modes

| Feature         | Legacy Mode                      | V2 Mode                  |
| --------------- | -------------------------------- | ------------------------ |
| Control Plane   | Database + Nomad                 | mgmt-airo + mgmt-hosting |
| SSO Environment | `sso.dev-godaddy.com`            | `sso.test-godaddy.com`   |
| Deployment      | Manual via SQS                   | API-triggered            |
| Publish Button  | Hidden                           | Visible for V2 sites     |
| Site Fields     | No `subscription_id`/`system_id` | Has V2 metadata          |

### 3. For publishing the job to nomad, you would need to authenticate to the airo-builder dev private AWS account

Note: Ensure you have access to the `GD-AWS-USA-GD-AiroBuilde-Dev-Private (694282668781)` AWS account

Run the following in the terminal where you are about to run your local server (replace `<your_email>` with your GD email address)

```
eval $(aws-okta-processor authenticate -e -u <your_email> -o godaddy.okta.com -k airo-builder-dev -r arn:aws:iam::694282668781:role/GD-AWS-USA-GD-AiroBuilde-Dev-Private-PowerUser -a https://godaddy.okta.com/home/amazon_aws/0oakmpp1rkb2ZuZsQ0x7/272 -f token:hardware:yubico -d 7200)
```

Or add the following to your `.bashrc` or `.zshrc` (so that you can just run `ab_dev` the next time)

```
alias ab_dev='eval $(aws-okta-processor authenticate -e -u <your_email> -o godaddy.okta.com -k airo-builder-dev -r arn:aws:iam::694282668781:role/GD-AWS-USA-GD-AiroBuilde-Dev-Private-PowerUser -a https://godaddy.okta.com/home/amazon_aws/0oakmpp1rkb2ZuZsQ0x7/272 -f token:hardware:yubico -d 7200)'
```

### 4. Run the dev server with fake https

```
PORT=443 npm run dev -- --experimental-https
```

Open `https://airo-builder.dev-godaddy.com` - you would see SSL errors, just acknowledge and proceed.

The AWS auth expires every couple of hours, if you see site creation failures, kill the node server by `CTRL + C` and redo step 3 and 4

### (Optional) 5. If there are change in the v3 template or the agent, they need to be published to ECR before creating a new site to test them again

1. `cd agents` or `cd app-templates/v3`
2. `export NOMAD_SPEC_IMAGE_VERSION=pre-dev-v1.0.0`
3. Authenticate to `GD-AWS-USA-GD-PioneerC1-Dev-Private (418549769352)` - `PowerUser` using the okta processor.
4. Execute the `deploy.sh` (ie., `./deploy.sh`)
