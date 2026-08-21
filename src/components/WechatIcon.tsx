export default function WechatIcon({ size = 16, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* WeChat double-bubble logo */}
      <path d="M9.5 4C5.91 4 3 6.46 3 9.5c0 1.73.96 3.27 2.46 4.27L4.8 15.8c-.08.27.2.5.45.37l2.22-1.11c.63.17 1.3.27 2 .27.14 0 .28-.01.42-.02A5.9 5.9 0 009.5 13.5c0-3.04 2.91-5.5 6.5-5.5.34 0 .67.03 1 .07C16.12 5.68 13.06 4 9.5 4zm-2 4a.75.75 0 110-1.5.75.75 0 010 1.5zm4.5 0a.75.75 0 110-1.5.75.75 0 010 1.5z" />
      <path d="M16 9c-3.04 0-5.5 2.01-5.5 4.5S12.96 18 16 18c.56 0 1.1-.07 1.62-.2l1.83.91c.25.13.53-.1.44-.37l-.5-1.65C20.28 15.82 21 14.72 21 13.5 21 11.01 18.54 9 16 9zm-2 4a.75.75 0 110-1.5.75.75 0 010 1.5zm3.5 0a.75.75 0 110-1.5.75.75 0 010 1.5z" />
    </svg>
  );
}
