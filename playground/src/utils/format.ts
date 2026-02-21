export function fmt(n: number): string {
  return n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(n);
}

export function fmtB(b: number): string {
  return b >= 1073741824
    ? (b / 1073741824).toFixed(1) + ' GB'
    : b >= 1048576
      ? (b / 1048576).toFixed(0) + ' MB'
      : b >= 1024
        ? (b / 1024).toFixed(0) + ' KB'
        : b + ' B';
}
