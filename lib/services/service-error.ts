export class ServiceError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ServiceError";
    this.status = status;
  }
}

export function getServiceErrorStatus(error: unknown, fallback = 500) {
  if (error instanceof ServiceError) {
    return error.status;
  }

  return fallback;
}

export function getServiceErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
}
