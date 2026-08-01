export interface BindingConnectionState {
  id: string;
  status: string;
  active: boolean;
  reauthorizationRequired: boolean;
  updatedAt: string;
}

export function bindingConnectionChanged(before: BindingConnectionState[], after: BindingConnectionState[]): boolean {
  const previous = new Map(before.filter((binding) => binding.active).map((binding) => [binding.id, binding]));
  return after.some((binding) => {
    if (!binding.active || binding.status !== 'active' || binding.reauthorizationRequired) return false;
    const old = previous.get(binding.id);
    return !old || old.updatedAt !== binding.updatedAt || old.status !== 'active' || old.reauthorizationRequired;
  });
}
