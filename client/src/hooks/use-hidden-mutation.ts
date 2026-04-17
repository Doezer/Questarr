import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface HiddenMutationResponse {
  hidden: boolean;
}

interface BaseHiddenMutationOptions {
  hiddenSuccessMessage?: string;
  unhiddenSuccessMessage?: string;
  errorMessage?: string;
}

interface HiddenMutationPayload {
  gameId: string;
  hidden: boolean;
}

interface CustomHiddenMutationOptions<TPayload> extends BaseHiddenMutationOptions {
  mutationFn: (payload: TPayload) => Promise<HiddenMutationResponse>;
}

interface DefaultHiddenMutationOptions extends BaseHiddenMutationOptions {
  mutationFn?: undefined;
}

/**
 * `useHiddenMutation` has two usage modes:
 * 1. Default mode (no custom `mutationFn`): use for standard hide/unhide by `{ gameId, hidden }`.
 * 2. Generic custom mode (`useHiddenMutation<TPayload>`): use when payload is not `{ gameId, hidden }`,
 *    for example Discovery page where the payload is a full `Game` and the mutation decides whether to
 *    PATCH an existing local game or POST a new hidden one.
 */
export function useHiddenMutation(
  options?: DefaultHiddenMutationOptions
): ReturnType<typeof useMutation<HiddenMutationResponse, Error, HiddenMutationPayload>>;
export function useHiddenMutation<TPayload>(
  options: CustomHiddenMutationOptions<TPayload>
): ReturnType<typeof useMutation<HiddenMutationResponse, Error, TPayload>>;
export function useHiddenMutation<TPayload = HiddenMutationPayload>(
  options?: DefaultHiddenMutationOptions | CustomHiddenMutationOptions<TPayload>
) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const isHiddenMutationPayload = (payload: unknown): payload is HiddenMutationPayload => {
    if (!payload || typeof payload !== "object") return false;

    const candidate = payload as Record<string, unknown>;
    return typeof candidate.gameId === "string" && typeof candidate.hidden === "boolean";
  };

  const onSuccess = (data: HiddenMutationResponse) => {
    queryClient.invalidateQueries({ queryKey: ["/api/games"] });
    toast({
      description: data.hidden
        ? (options?.hiddenSuccessMessage ?? "Game hidden")
        : (options?.unhiddenSuccessMessage ?? "Game unhidden"),
    });
  };

  const onError = () => {
    toast({
      description: options?.errorMessage ?? "Failed to update game visibility",
      variant: "destructive",
    });
  };

  const mutationFn = async (payload: TPayload): Promise<HiddenMutationResponse> => {
    if (options?.mutationFn) {
      return options.mutationFn(payload);
    }

    if (!isHiddenMutationPayload(payload)) {
      throw new Error("useHiddenMutation default mode expects { gameId, hidden } payload");
    }

    const response = await apiRequest("PATCH", `/api/games/${payload.gameId}/hidden`, {
      hidden: payload.hidden,
    });

    return (await response.json()) as HiddenMutationResponse;
  };

  return useMutation<HiddenMutationResponse, Error, TPayload>({
    mutationFn,
    onSuccess,
    onError,
  });
}
