"use client";

import Image from "next/image";
import { useState } from "react";
import { contactPhotoUrl } from "@/lib/contact-photo";

export function Avatar({
  initials,
  color = "",
  large = false,
  photoUrl,
}: {
  initials: string;
  color?: string;
  large?: boolean;
  photoUrl?: string | null;
}) {
  const src = contactPhotoUrl(photoUrl);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  return (
    <span className={`avatar ${color} ${large ? "large" : ""}`}>
      {initials}
      {src && src !== failedSrc ? (
        <Image
          key={src}
          src={src}
          alt=""
          fill
          sizes={large ? "44px" : "34px"}
          unoptimized
          referrerPolicy="no-referrer"
          onError={() => setFailedSrc(src)}
        />
      ) : null}
    </span>
  );
}
