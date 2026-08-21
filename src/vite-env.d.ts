/// <reference types="vite/client" />

declare module '*.js?raw' {
  const src: string;
  export default src;
}
