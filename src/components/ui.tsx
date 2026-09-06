import type { ButtonHTMLAttributes, ReactNode } from "react";

const paths = {
  chat: "M4 4h16v12H9l-5 4V4Z",
  draft: "M5 3h10l4 4v14H5V3Zm10 0v5h4M8 12h8M8 16h5",
  agent:
    "M8 6V4m8 2V4M5 8h14v12H5V8Zm4 5h.01M15 13h.01M9 17h6M2 12v4m20-4v4M10 4h4",
  settings:
    "m9 3-.6 3-2 .9-2.7-.8-2 3.5L4 11v2l-2.3 1.4 2 3.5 2.7-.8 2 .9.6 3h4l.6-3 2-.9 2.7.8 2-3.5L18 13v-2l2.3-1.4-2-3.5-2.7.8-2-.9L13 3H9ZM11 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6",
  switcher: "m9 8 3-3 3 3m-6 8 3 3 3-3",
  search: "M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14m5 12 6 6",
  plus: "M12 5v14M5 12h14",
  check: "m5 12 4 4L19 6",
  close: "m6 6 12 12M6 18 18 6",
  arrow: "M5 12h14m-5-5 5 5-5 5",
  back: "M19 12H5m5-5-5 5 5 5",
  send: "m3 3 19 9-19 9 4-9-4-9Zm4 9h15",
  spark: "m12 3 2.3 6.7L21 12l-6.7 2.3L12 21l-2.3-6.7L3 12l6.7-2.3L12 3Z",
  refresh: "M20 7V3l-3 3a8 8 0 1 0 2.3 9M20 3h-4",
  edit: "m14 4 6 6M4 20l4-1 13-13-4-4L4 15v5Z",
  clock: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18m0 4v6l4 2",
  warning: "m12 3 10 18H2L12 3Zm0 6v5m0 3h.01",
  info: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18m0 8v6m0-10h.01",
  panel: "M3 4h18v16H3V4Zm12 0v16",
  book: "M3 4h7l2 2 2-2h7v16h-7l-2 2-2-2H3V4Zm9 2v16",
  chevron: "m9 5 7 7-7 7",
  users:
    "M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8M2 21v-3a7 7 0 0 1 14 0v3m1-17a4 4 0 0 1 0 8m2 3a6 6 0 0 1 3 6",
  link: "m10 7 2-2a5 5 0 0 1 7 7l-2 2m-3 3-2 2a5 5 0 0 1-7-7l2-2m1 6 8-8",
  inbox: "M5 3h14l3 12v6H2v-6L5 3ZM2 15h6l2 3h4l2-3h6",
  more: "M5 12h.01M12 12h.01M19 12h.01",
};
export type IconName = keyof typeof paths;
export function Icon({ name }: { name: IconName }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d={paths[name]} />
    </svg>
  );
}
export function Button({
  children,
  icon,
  variant = "",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: IconName;
  variant?: string;
}) {
  return (
    <button type="button" className={`btn ${variant} ${className}`} {...props}>
      {icon ? <Icon name={icon} /> : null}
      {children}
    </button>
  );
}
export function IconButton({
  label,
  icon,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  icon: IconName;
}) {
  return (
    <Button
      variant="ghost icon-only"
      aria-label={label}
      title={label}
      icon={icon}
      {...props}
    />
  );
}
export { Avatar } from "./avatar";
export function Badge({
  children,
  color = "",
}: {
  children: ReactNode;
  color?: string;
}) {
  return <span className={`pill ${color}`}>{children}</span>;
}
export function Spark() {
  return (
    <span className="sparkbox">
      <Icon name="spark" />
    </span>
  );
}
export function Notice({
  title,
  children,
  variant = "info",
}: {
  title?: string;
  children: ReactNode;
  variant?: string;
}) {
  return (
    <div
      className={`notice ${variant}`}
      role={variant === "error" ? "alert" : undefined}
    >
      <Icon
        name={
          variant === "error"
            ? "warning"
            : variant === "success"
              ? "check"
              : "info"
        }
      />
      <div>
        {title ? <strong>{title}</strong> : null}
        {children}
      </div>
    </div>
  );
}
export function Empty({
  title,
  children,
  action,
  icon = "inbox",
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
  icon?: IconName;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon name={icon} />
      </div>
      <h2>{title}</h2>
      <p>{children}</p>
      {action}
    </div>
  );
}
export function Topbar({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <header className="topbar">
      <h1>{title}</h1>
      <div className="grow" />
      {children}
    </header>
  );
}
