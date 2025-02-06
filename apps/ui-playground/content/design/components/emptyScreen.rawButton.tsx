"use client";

import { RenderComponentWithSnippet } from "@/app/components/render";

import { Button, EmptyScreen } from "@calcom/ui";

export const RawButtonExample: React.FC = () => (
  <RenderComponentWithSnippet>
    <EmptyScreen
      Icon="link"
      headline="No links found"
      description="Create a new link to share"
      buttonRaw={
        <div className="flex space-x-2">
          <Button color="primary" onClick={() => alert("Create Link clicked")}>
            Create Link
          </Button>
          <Button color="secondary" onClick={() => alert("Import Links clicked")}>
            Import Links
          </Button>
        </div>
      }
    />
  </RenderComponentWithSnippet>
);
