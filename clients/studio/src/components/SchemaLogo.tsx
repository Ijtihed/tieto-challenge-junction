export default function SchemaLogo({ className = "w-8 h-8" }: { className?: string }) {
  return (
    <img
      src="/logo-transparent.png"
      alt="Schema"
      className={className}
      draggable={false}
    />
  );
}
