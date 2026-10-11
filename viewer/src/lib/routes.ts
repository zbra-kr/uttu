export const ROUTES = {
  product: (no: string) => `/product?no=${encodeURIComponent(no)}`,
  productCompare: (no: string) => `/product/compare?no=${encodeURIComponent(no)}`,
  matching: '/matching',
  login: '/login',
} as const;
