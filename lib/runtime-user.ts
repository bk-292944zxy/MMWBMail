import { getLocalOwnerId } from "@/lib/local-owner";

export async function getRuntimeUserId() {
  return getLocalOwnerId();
}
