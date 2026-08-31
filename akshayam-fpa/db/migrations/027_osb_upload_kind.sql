-- A distinct upload kind for the outside-books load, so Settings -> Uploads
-- can tell it apart from an ordinary Invoice Details export rather than
-- filing five manually-entered invoices under the same kind as the next
-- real one and confusing the audit trail between them.
alter type upload_kind add value if not exists 'osb';
