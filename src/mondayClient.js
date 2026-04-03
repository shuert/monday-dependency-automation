const axios = require("axios");

const MONDAY_API_URL = "https://api.monday.com/v2";

/**
 * Execute a GraphQL query/mutation against the monday.com API.
 * @param {string} authToken - Optional. User short-lived token from integration JWT, or defaults to MONDAY_API_TOKEN.
 */
async function mondayRequest(query, variables = {}, authToken) {
  const token = authToken || process.env.MONDAY_API_TOKEN;
  if (!token) {
    throw new Error("No monday API token (set MONDAY_API_TOKEN or pass shortLivedToken)");
  }

  const response = await axios.post(
    MONDAY_API_URL,
    { query, variables },
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: token,
        "API-Version": "2024-01",
      },
    }
  );

  if (response.data.errors) {
    const msg = response.data.errors.map((e) => e.message).join(", ");
    throw new Error(`monday API error: ${msg}`);
  }

  return response.data.data;
}

async function getSuccessorItemIds(boardId, completedItemId, authToken) {
  const query = `
    query GetBoardDependencies($boardId: [ID!]!) {
      boards(ids: $boardId) {
        items_page(limit: 500) {
          items {
            id
            column_values(types: dependency) {
              ... on DependencyValue {
                linked_item_ids
              }
            }
          }
        }
      }
    }
  `;

  const data = await mondayRequest(query, { boardId: [String(boardId)] }, authToken);
  const items = data?.boards?.[0]?.items_page?.items || [];
  const completedId = String(completedItemId);

  const successors = [];
  for (const item of items) {
    for (const col of item.column_values) {
      if (col.linked_item_ids?.includes(completedId)) {
        successors.push(item.id);
        break;
      }
    }
  }
  return successors;
}

async function getItemStatus(itemId, statusColumnId, authToken) {
  const query = `
    query GetItemStatus($itemId: [ID!]!, $columnId: [String!]!) {
      items(ids: $itemId) {
        column_values(ids: $columnId) {
          ... on StatusValue {
            label
          }
        }
      }
    }
  `;

  const data = await mondayRequest(
    query,
    {
      itemId: [String(itemId)],
      columnId: [statusColumnId],
    },
    authToken
  );

  const label = data?.items?.[0]?.column_values?.[0]?.label;
  return label ?? null;
}

async function setItemStatus(boardId, itemId, statusColumnId, label, authToken) {
  const mutation = `
    mutation SetStatus($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
      change_column_value(
        board_id: $boardId
        item_id: $itemId
        column_id: $columnId
        value: $value
      ) {
        id
      }
    }
  `;

  await mondayRequest(
    mutation,
    {
      boardId: String(boardId),
      itemId: String(itemId),
      columnId: statusColumnId,
      value: JSON.stringify({ label }),
    },
    authToken
  );
}

async function createWebhookSubscription(boardId, webhookUrl) {
  const mutation = `
    mutation CreateWebhook($boardId: ID!, $url: String!, $event: WebhookEventType!) {
      create_webhook(board_id: $boardId, url: $url, event: $event) {
        id
        board_id
      }
    }
  `;

  return await mondayRequest(mutation, {
    boardId: String(boardId),
    url: webhookUrl,
    event: "change_column_value",
  });
}

async function deleteWebhookSubscription(webhookId) {
  const mutation = `
    mutation DeleteWebhook($id: ID!) {
      delete_webhook(id: $id) {
        id
      }
    }
  `;
  return await mondayRequest(mutation, { id: String(webhookId) });
}

async function findOurWebhooks(boardId, ourHost) {
  const query = `
    query GetWebhooks($boardId: ID!) {
      webhooks(board_id: $boardId) {
        id
        board_id
        event
        config
      }
    }
  `;

  try {
    const data = await mondayRequest(query, { boardId: String(boardId) });
    const all = data?.webhooks || [];
    if (!ourHost) return all;
    return all.filter((w) => w.config?.includes(ourHost));
  } catch {
    return [];
  }
}

/**
 * Resolve board id for an item (used when trigger does not expose boardId).
 */
async function getBoardIdForItem(itemId, authToken) {
  const query = `
    query BoardForItem($id: [ID!]!) {
      items(ids: $id) {
        board {
          id
        }
      }
    }
  `;
  const data = await mondayRequest(query, { id: [String(itemId)] }, authToken);
  const id = data?.items?.[0]?.board?.id;
  return id != null ? String(id) : null;
}

module.exports = {
  getSuccessorItemIds,
  getItemStatus,
  setItemStatus,
  createWebhookSubscription,
  deleteWebhookSubscription,
  findOurWebhooks,
  getBoardIdForItem,
};
