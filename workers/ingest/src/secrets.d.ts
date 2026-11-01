// secret は wrangler.jsonc に出ないので、wrangler types の worker-configuration.d.ts にも出ない
interface Env {
  X_REFRESH_TOKEN: string;
  X_CLIENT_ID: string;
  X_USER_ID: string;
}

declare namespace Cloudflare {
  interface Env {
    X_REFRESH_TOKEN: string;
    X_CLIENT_ID: string;
    X_USER_ID: string;
  }
}
