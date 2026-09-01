const SECRET_NAME = /(?:KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL|AUTH|PRIVATE|ACCESS|SESSION)/i
const PACKAGE_MANAGER_NAME = /^(?:npm|pnpm|yarn|corepack)(?:_|$)/i
const NODE_OPTIONS = new Set(['NODE_PATH', 'NODE_OPTIONS'])
const AUTH_AGENT_NAMES = new Set([
  'GIT_ASKPASS',
  'GIT_SSH_COMMAND',
  'SSH_ASKPASS',
  'SSH_AUTH_SOCK',
  'SSH_AGENT_PID',
  'GPG_AGENT_INFO',
  'GNUPGHOME',
])
const CLOUD_CONFIG_NAMES = new Set([
  'AWS_CONFIG_FILE',
  'AWS_SHARED_CREDENTIALS_FILE',
  'AWS_PROFILE',
  'AZURE_CONFIG_DIR',
  'CLOUDSDK_CONFIG',
  'DOCKER_CONFIG',
  'GOOGLE_GHA_CREDS_PATH',
  'KUBECONFIG',
  'OCI_CLI_CONFIG_FILE',
  'BOTO_CONFIG',
  'NETRC',
])
const CLOUD_CONFIG_PREFIX = /^(?:AWS|AZURE|GOOGLE|GCP|CLOUDSDK|DOCKER|KUBECONFIG|OCI|ALIBABA_CLOUD|IBM_CLOUD|HEROKU|VERCEL|NETLIFY)_/i
const POLICY_OVERRIDE_NAMES = new Set([
  'NPM_CONFIG_REGISTRY',
  'PNPM_CONFIG_REGISTRY',
  'NPM_CONFIG_USERCONFIG',
  'PNPM_CONFIG_USERCONFIG',
  'PNPM_CONFIG_STORE_DIR',
  'NPM_CONFIG_CACHE',
  'GIT_CONFIG_GLOBAL',
  'GIT_CONFIG_NOSYSTEM',
])
const XDG_CONFIG_NAMES = new Set([
  'XDG_CONFIG_HOME',
  'XDG_CONFIG_DIRS',
  'XDG_CACHE_HOME',
  'XDG_DATA_HOME',
  'XDG_STATE_HOME',
  'XDG_RUNTIME_DIR',
])
const GIT_CONFIG_PREFIX = /^GIT_CONFIG(?:_|$)/i

function scrubbed(name) {
  const upper = name.toUpperCase()
  return SECRET_NAME.test(name)
    || PACKAGE_MANAGER_NAME.test(name)
    || NODE_OPTIONS.has(upper)
    || AUTH_AGENT_NAMES.has(upper)
    || CLOUD_CONFIG_NAMES.has(upper)
    || CLOUD_CONFIG_PREFIX.test(name)
    || XDG_CONFIG_NAMES.has(upper)
    || GIT_CONFIG_PREFIX.test(name)
}

/**
 * Build a child environment without inherited credentials or tool configuration.
 * Allowlisted policy overrides are applied after scrubbing and therefore win.
 *
 * @param {Record<string, string | undefined>} overrides explicit child values
 * @param {Record<string, string | undefined>} source inherited environment
 * @returns {Record<string, string>} sanitized child environment
 */
export function sanitizedSubprocessEnv(overrides = {}, source = process.env) {
  const environment = {}
  for (const [name, value] of Object.entries(source)) {
    if (value !== undefined && !scrubbed(name)) environment[name] = value
  }
  for (const [name, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete environment[name]
      continue
    }
    if (!scrubbed(name) || POLICY_OVERRIDE_NAMES.has(name.toUpperCase())) environment[name] = value
  }
  return environment
}

/** Return whether an environment name is removed from child processes. */
export function isScrubbedSubprocessName(name) {
  return scrubbed(name)
}
