"use client";
import { CacheProvider } from "@chakra-ui/next-js";
import { ChakraProvider } from "@chakra-ui/react";
import { ReactFlowProvider } from "reactflow";
import { DiagramSettingsProvider } from "../hooks/useDiagramSettings";

export default function ClientProviders({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <CacheProvider>
      <ChakraProvider>
        <ReactFlowProvider>
          <DiagramSettingsProvider>{children}</DiagramSettingsProvider>
        </ReactFlowProvider>
      </ChakraProvider>
    </CacheProvider>
  );
}
