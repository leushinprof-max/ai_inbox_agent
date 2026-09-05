export default function Loading() {
  return (
    <div className="content-scroll" role="status" aria-label="Loading">
      <div className="skeleton wide" />
      <div className="skeleton wide" />
      <div className="skeleton medium" />
    </div>
  );
}
