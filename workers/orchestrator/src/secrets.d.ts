// secret は wrangler.jsonc に出ないので、wrangler types の worker-configuration.d.ts にも出ない
interface Env {
  GITHUB_TOKEN: string;
}

declare namespace Cloudflare {
  interface Env {
    GITHUB_TOKEN: string;
  }
}
