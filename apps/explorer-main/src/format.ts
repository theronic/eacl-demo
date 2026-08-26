const integerFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

const millisecondFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 2,
});

export function formatInteger(value: number): string {
  return integerFormatter.format(value);
}

export function formatMilliseconds(value: number): string {
  return millisecondFormatter.format(value);
}
