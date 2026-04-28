import type { ApiRequestOptions, ServiceHealth } from "../types";
import { createJsonApiClient } from "./http";

const botClient = createJsonApiClient("/bot");

export const botApi = {
  getHealth(options?: ApiRequestOptions) {
    return botClient.get<ServiceHealth>("/health", undefined, options);
  },
};
