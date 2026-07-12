import { fetchApi } from "@/lib/api/client"
import type {
  CreateWebhookEndpointInput,
  CreateWebhookEndpointResult,
  UpdateWebhookEndpointInput,
  WebhookDeliverySummary,
  WebhookEndpointSummary,
} from "@/lib/types/models"

export async function listWebhooks(signal?: AbortSignal) {
  return fetchApi<WebhookEndpointSummary[]>("/webhooks", { signal })
}

export async function createWebhookEndpoint(input: CreateWebhookEndpointInput) {
  return fetchApi<CreateWebhookEndpointResult>("/webhooks", {
    method: "POST",
    body: input,
  })
}

export async function updateWebhookEndpoint(id: string, input: UpdateWebhookEndpointInput) {
  return fetchApi<CreateWebhookEndpointResult>("/webhooks/" + encodeURIComponent(id), {
    method: "PATCH",
    body: input,
  })
}

export async function deleteWebhookEndpoint(id: string) {
  return fetchApi<{ success: boolean }>("/webhooks/" + encodeURIComponent(id), {
    method: "DELETE",
  })
}

export async function listWebhookDeliveries(endpointId: string, signal?: AbortSignal) {
  return fetchApi<WebhookDeliverySummary[]>(
    "/webhooks/" + encodeURIComponent(endpointId) + "/deliveries",
    { signal }
  )
}

export async function testWebhookEndpoint(endpointId: string) {
  return fetchApi<{ delivery: WebhookDeliverySummary }>(
    "/webhooks/" + encodeURIComponent(endpointId) + "/test",
    {
      method: "POST",
    }
  )
}

