import useSWR from "swr";
import type { ClientSceneConfig, IClientScenesService } from "@zcode/services";

const CLIENT_SCENES_RESOURCE_KEY = "client-scenes";
const CLIENT_SCENES_DEDUPING_INTERVAL_MS = 10 * 60 * 1000;

const EMPTY_SCENES: ClientSceneConfig[] = [];
const serviceAuthorityIds = new WeakMap<IClientScenesService, number>();
let nextServiceAuthorityId = 1;

function getServiceAuthorityId(service: IClientScenesService): number {
  const existing = serviceAuthorityIds.get(service);
  if (existing !== undefined) return existing;
  const next = nextServiceAuthorityId;
  nextServiceAuthorityId += 1;
  serviceAuthorityIds.set(service, next);
  return next;
}

class ClientScenesBusinessError extends Error {
  readonly code: number;
  readonly responseMessage: string;

  constructor(code: number, responseMessage: string) {
    super(`Client Scenes returned business error ${code}: ${responseMessage}`);
    this.name = "ClientScenesBusinessError";
    this.code = code;
    this.responseMessage = responseMessage;
  }
}

export function isClientScenesBusinessError(error: unknown): error is ClientScenesBusinessError {
  return error instanceof ClientScenesBusinessError;
}

interface UseClientScenesResourceOptions {
  enabled?: boolean;
}

export function useClientScenesResource(
  clientScenesService: IClientScenesService,
  options: UseClientScenesResourceOptions = {},
) {
  const enabled = options.enabled ?? true;
  const authorityId = getServiceAuthorityId(clientScenesService);
  const resource = useSWR<ClientSceneConfig[], Error>(
    enabled ? [CLIENT_SCENES_RESOURCE_KEY, authorityId] : null,
    async () => {
      const response = await clientScenesService.list();
      if (response.code !== 0) {
        throw new ClientScenesBusinessError(response.code, response.msg);
      }
      return response.data;
    },
    {
      dedupingInterval: CLIENT_SCENES_DEDUPING_INTERVAL_MS,
      focusThrottleInterval: CLIENT_SCENES_DEDUPING_INTERVAL_MS,
      keepPreviousData: false,
      refreshInterval: 0,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      shouldRetryOnError: false,
    },
  );

  return {
    scenes: resource.data ?? EMPTY_SCENES,
    loading: enabled && resource.data === undefined && resource.isLoading,
    revalidating: resource.isValidating,
    error: resource.error,
    revalidate: resource.mutate,
  };
}
