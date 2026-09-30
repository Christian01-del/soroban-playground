"use client";

import React from "react";
import XdrDecoderInspector from "@/components/XdrDecoderInspector";
import SidebarShell from "@/components/Sidebar";

export default function XdrDecoderPage() {
  return (
    <SidebarShell>
      <div className="p-6 max-w-7xl mx-auto h-[calc(100vh-2rem)]">
        <XdrDecoderInspector />
      </div>
    </SidebarShell>
  );
}
