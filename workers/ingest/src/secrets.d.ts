// secret は wrangler.jsonc に出ないので、wrangler types の worker-configuration.d.ts にも出ない
interface Env {
  IFTTT_SECRET: string;
}

declare namespace Cloudflare {
  interface Env {
    IFTTT_SECRET: string;
  }
}
