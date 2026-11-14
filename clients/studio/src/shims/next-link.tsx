import { forwardRef, type AnchorHTMLAttributes, type ReactNode } from "react";

const Link = forwardRef<HTMLAnchorElement, AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children?: ReactNode }>(
  ({ href, children, ...rest }, ref) => <a ref={ref} href={href} {...rest}>{children}</a>
);
Link.displayName = "Link";
export default Link;
