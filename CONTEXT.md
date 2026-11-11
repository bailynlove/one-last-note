# Note Management

A collaborative note-management product for collecting documents, discussing them, and organizing them into shared Knowledge Bases.

## Language

**Note**:
An uploaded or web-saved document that can be rendered and discussed. Its content can belong to multiple Knowledge Bases, while its Comments and Marks are scoped to each Knowledge Base; removing it from one Knowledge Base leaves it in the others.

**Revision**:
An immutable version of a Note’s original file, preserved separately from its rendering representation. File replacement creates a new Revision shared by all Knowledge Base associations, and prior Revisions remain viewable.

**Relation**:
A Knowledge Base-scoped connection between two Note associations. Manual Relations use a built-in label and direction and persist across Revisions; a Content Reference is a directed connection found in a specific source Revision.

**Trash**:
The 30-day recoverable state of a removed Knowledge Base association and its scoped annotations, or of a deleted Knowledge Base with its memberships, associations, and scoped annotations. Trashing the last association makes the whole Note inaccessible before permanent purge.

**Knowledge Base**:
A named collection of Notes with its own membership and permissions. It is the product’s only collaboration and role boundary.
_Avoid_: Folder, workspace, organization

**User**:
An individual person’s identity, used for Knowledge Base membership and authorship.
_Avoid_: Account, organization

**Agent**:
A third-party MCP client acting on behalf of a User through a named personal access token, constrained by both the User’s roles and the token’s scopes.
_Avoid_: Independent agent member

**Owner**:
The single Knowledge Base member who manages elevated roles, Knowledge Base settings, Knowledge Base deletion, and ownership transfer.

**Manager**:
A Knowledge Base member who can add and remove Notes and invite or remove Viewers.

**Viewer**:
A Knowledge Base member who can read Notes and add Comments and Marks without changing the collection.
_Avoid_: Read-only member

**Invitation**:
An email addressed offer for a User to join a Knowledge Base as a Manager or Viewer.

**Join Link**:
An Owner-issued, multi-use, expiring, revocable link that grants a signed-in User its designated Manager or Viewer role.

**Annotation**:
A Comment or Mark attached to a Note through an Anchor and scoped to one Knowledge Base.

**Anchor**:
A Revision-specific reference to selected content. Text Anchors combine exact text, surrounding context, and structural hints; PDF region Anchors use page and normalized coordinates.

**Comment**:
A message attached by an identified Knowledge Base member to a selected text passage or PDF region in a Note. It is visible only within that Knowledge Base.

**Mark**:
A visual annotation attached to a selected passage or region without comment text. It is visible only within its Knowledge Base.
_Avoid_: Comment

**Highlight**:
The built-in Mark type that visually emphasizes a selected passage or region.

**Saver**:
A browser extension that creates clean HTML Notes from readable web pages or selected passages, retaining source metadata.

**Renderer**:
A component that turns an immutable Revision into selectable content with navigation capabilities and diagnostics. Built-in and App Extension renderers share the same contract.

**App Extension**:
An extension installed and enabled for a Knowledge Base that adds an external file-format Renderer or a custom Mark type for its members.
_Avoid_: Browser extension, Saver
