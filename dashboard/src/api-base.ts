export function resolveApiBase(configuredValue?: string): string {
  return configuredValue || '/v1';
}
