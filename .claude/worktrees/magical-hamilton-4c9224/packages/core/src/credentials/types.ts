/**
 * Per-service credential payload shapes.
 * Each service has different requirements. These types are the source of truth.
 */

export type CredentialService =
  | "google_analytics"
  | "google_search_console"
  | "google_adsense"
  | "instagram_graph"
  | "github_deploy"
  | "astro_deploy_webhook";

export type GoogleServiceAccountPayload = {
  type: "service_account";
  project_id: string;
  private_key_id: string;
  private_key: string;
  client_email: string;
  client_id: string;
  [key: string]: unknown;
};

export type GoogleAnalyticsCreds = {
  serviceAccount: GoogleServiceAccountPayload;
  propertyId: string;
};

export type GoogleSearchConsoleCreds = {
  serviceAccount: GoogleServiceAccountPayload;
  siteUrl: string;
};

export type GoogleAdSenseCreds = {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
  accountId: string;
};

export type InstagramGraphCreds = {
  longLivedAccessToken: string;
  igUserId: string;
  pageId: string;
};

export type GithubDeployCreds = {
  token: string;
  repo: string;
  branch: string;
};

export type AstroDeployWebhookCreds = {
  webhookUrl: string;
  secretHeader?: { name: string; value: string };
};

export type CredentialPayload<S extends CredentialService> = S extends "google_analytics"
  ? GoogleAnalyticsCreds
  : S extends "google_search_console"
    ? GoogleSearchConsoleCreds
    : S extends "google_adsense"
      ? GoogleAdSenseCreds
      : S extends "instagram_graph"
        ? InstagramGraphCreds
        : S extends "github_deploy"
          ? GithubDeployCreds
          : S extends "astro_deploy_webhook"
            ? AstroDeployWebhookCreds
            : never;
