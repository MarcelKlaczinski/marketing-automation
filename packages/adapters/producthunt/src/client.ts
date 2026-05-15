import { GraphQLClient } from "graphql-request";

const PH_ENDPOINT   = "https://api.producthunt.com/v2/api/graphql";
const TOKEN_ENDPOINT = "https://api.producthunt.com/v2/oauth/token";

/**
 * Exchanges client_id + client_secret for an OAuth2 access token
 * using the client_credentials grant (server-to-server, no user context).
 */
export async function fetchAccessToken(apiKey: string, apiSecret: string): Promise<string> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_id:     apiKey,
      client_secret: apiSecret,
      grant_type:    "client_credentials",
    }),
  });
  if (!res.ok) throw new Error(`PH token exchange failed: HTTP ${res.status}`);
  const body = await res.json() as { access_token?: string; error?: string };
  if (!body.access_token) throw new Error(body.error ?? "PH token exchange: no access_token in response");
  return body.access_token;
}

export function createProductHuntClient(accessToken: string): GraphQLClient {
  return new GraphQLClient(PH_ENDPOINT, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
}

// Fetches newest posts under a topic. "artificial-intelligence" covers the broad AI category.
// PH topic slugs are stable — safe to hardcode as the default.
export const POSTS_BY_TOPIC_QUERY = /* GraphQL */ `
  query PostsByTopic($topic: String!, $first: Int!) {
    posts(topic: $topic, order: NEWEST, first: $first) {
      edges {
        node {
          id
          slug
          name
          tagline
          description
          url
          website
          votesCount
          commentsCount
          createdAt
          user { name }
          topics { edges { node { slug name } } }
          makers { name }
        }
      }
    }
  }
`;

export type PhPost = {
  id: string;
  slug: string;
  name: string;
  tagline: string;
  description: string;
  url: string;
  website: string | null;
  votesCount: number;
  commentsCount: number;
  createdAt: string;
  user: { name: string } | null;
  topics: { edges: Array<{ node: { slug: string; name: string } }> };
  makers: Array<{ name: string }>;
};
