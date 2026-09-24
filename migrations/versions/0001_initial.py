"""Frozen initial Quarkmed PostgreSQL schema (2026-09-21)."""

from alembic import op

revision = "0001"
down_revision = None

DDL = [
    "\nCREATE TABLE departments (\n\tname VARCHAR(160) NOT NULL, \n\tparent_id VARCHAR(36), \n\tid VARCHAR(36) NOT NULL, \n\tcreated_at TIMESTAMP WITH TIME ZONE NOT NULL, \n\tPRIMARY KEY (id), \n\tUNIQUE (name), \n\tFOREIGN KEY(parent_id) REFERENCES departments (id)\n)\n\n",
    "\nCREATE TABLE template_categories (\n\tname VARCHAR(100) NOT NULL, \n\tactive BOOLEAN NOT NULL, \n\tposition INTEGER NOT NULL, \n\tid VARCHAR(36) NOT NULL, \n\tcreated_at TIMESTAMP WITH TIME ZONE NOT NULL, \n\tPRIMARY KEY (id), \n\tUNIQUE (name)\n)\n\n",
    "\nCREATE TABLE templates (\n\tname VARCHAR(200) NOT NULL, \n\tcategory_id VARCHAR(36) NOT NULL, \n\tdepartment_id VARCHAR(36), \n\tshared BOOLEAN NOT NULL, \n\tactive BOOLEAN NOT NULL, \n\tstatus VARCHAR(30) NOT NULL, \n\tcurrent_version_id VARCHAR(36), \n\tid VARCHAR(36) NOT NULL, \n\tcreated_at TIMESTAMP WITH TIME ZONE NOT NULL, \n\tPRIMARY KEY (id), \n\tFOREIGN KEY(category_id) REFERENCES template_categories (id), \n\tFOREIGN KEY(department_id) REFERENCES departments (id)\n)\n\n",
    "\nCREATE TABLE users (\n\tusername VARCHAR(100) NOT NULL, \n\tname VARCHAR(100) NOT NULL, \n\tpassword_hash TEXT NOT NULL, \n\trole VARCHAR(30) NOT NULL, \n\tdepartment_id VARCHAR(36), \n\temployee_no VARCHAR(80) NOT NULL, \n\tactive BOOLEAN NOT NULL, \n\tid VARCHAR(36) NOT NULL, \n\tcreated_at TIMESTAMP WITH TIME ZONE NOT NULL, \n\tPRIMARY KEY (id), \n\tUNIQUE (username), \n\tFOREIGN KEY(department_id) REFERENCES departments (id)\n)\n\n",
    "\nCREATE TABLE audit_events (\n\tactor_id VARCHAR(36) NOT NULL, \n\taction VARCHAR(80) NOT NULL, \n\tentity_id VARCHAR(36) NOT NULL, \n\tdetails JSONB NOT NULL, \n\tid VARCHAR(36) NOT NULL, \n\tcreated_at TIMESTAMP WITH TIME ZONE NOT NULL, \n\tPRIMARY KEY (id), \n\tFOREIGN KEY(actor_id) REFERENCES users (id)\n)\n\n",
    "\nCREATE TABLE notifications (\n\tuser_id VARCHAR(36) NOT NULL, \n\tmessage TEXT NOT NULL, \n\tproject_id VARCHAR(36), \n\tread BOOLEAN NOT NULL, \n\tid VARCHAR(36) NOT NULL, \n\tcreated_at TIMESTAMP WITH TIME ZONE NOT NULL, \n\tPRIMARY KEY (id), \n\tFOREIGN KEY(user_id) REFERENCES users (id)\n)\n\n",
    "\nCREATE TABLE projects (\n\tname VARCHAR(200) NOT NULL, \n\tcode VARCHAR(80) NOT NULL, \n\tdescription TEXT NOT NULL, \n\tfield VARCHAR(80) NOT NULL, \n\tbusiness_id VARCHAR(36) NOT NULL, \n\tleader_id VARCHAR(36) NOT NULL, \n\tdeadline VARCHAR(40) NOT NULL, \n\tversion INTEGER NOT NULL, \n\tstatus VARCHAR(30) NOT NULL, \n\tid VARCHAR(36) NOT NULL, \n\tcreated_at TIMESTAMP WITH TIME ZONE NOT NULL, \n\tPRIMARY KEY (id), \n\tUNIQUE (code), \n\tFOREIGN KEY(business_id) REFERENCES users (id), \n\tFOREIGN KEY(leader_id) REFERENCES users (id)\n)\n\n",
    "\nCREATE TABLE sessions (\n\ttoken_hash VARCHAR(64) NOT NULL, \n\tuser_id VARCHAR(36) NOT NULL, \n\texpires_at TIMESTAMP WITH TIME ZONE NOT NULL, \n\tid VARCHAR(36) NOT NULL, \n\tcreated_at TIMESTAMP WITH TIME ZONE NOT NULL, \n\tPRIMARY KEY (id), \n\tUNIQUE (token_hash), \n\tFOREIGN KEY(user_id) REFERENCES users (id)\n)\n\n",
    "\nCREATE TABLE template_versions (\n\ttemplate_id VARCHAR(36) NOT NULL, \n\tdocuments JSONB NOT NULL, \n\tdiagnostics JSONB NOT NULL, \n\tsource_asset_id VARCHAR(36), \n\tpublished BOOLEAN NOT NULL, \n\tid VARCHAR(36) NOT NULL, \n\tcreated_at TIMESTAMP WITH TIME ZONE NOT NULL, \n\tPRIMARY KEY (id), \n\tFOREIGN KEY(template_id) REFERENCES templates (id)\n)\n\n",
    "\nCREATE TABLE assets (\n\towner_id VARCHAR(36) NOT NULL, \n\tproject_id VARCHAR(36), \n\tname VARCHAR(240) NOT NULL, \n\tmedia_type VARCHAR(120) NOT NULL, \n\tpath TEXT NOT NULL, \n\tsize INTEGER NOT NULL, \n\tsha256 VARCHAR(64) NOT NULL, \n\tid VARCHAR(36) NOT NULL, \n\tcreated_at TIMESTAMP WITH TIME ZONE NOT NULL, \n\tPRIMARY KEY (id), \n\tFOREIGN KEY(owner_id) REFERENCES users (id), \n\tFOREIGN KEY(project_id) REFERENCES projects (id)\n)\n\n",
    "\nCREATE TABLE booklets (\n\tproject_id VARCHAR(36) NOT NULL, \n\towner_id VARCHAR(36) NOT NULL, \n\ttitle VARCHAR(200) NOT NULL, \n\tdeadline VARCHAR(40) NOT NULL, \n\texpected_pages INTEGER NOT NULL, \n\tinstructions TEXT NOT NULL, \n\tposition INTEGER NOT NULL, \n\tversion INTEGER NOT NULL, \n\tlatest_submission_id VARCHAR(36), \n\tid VARCHAR(36) NOT NULL, \n\tcreated_at TIMESTAMP WITH TIME ZONE NOT NULL, \n\tPRIMARY KEY (id), \n\tFOREIGN KEY(project_id) REFERENCES projects (id), \n\tFOREIGN KEY(owner_id) REFERENCES users (id)\n)\n\n",
    "\nCREATE TABLE jobs (\n\towner_id VARCHAR(36) NOT NULL, \n\tproject_id VARCHAR(36), \n\tkind VARCHAR(30) NOT NULL, \n\tstatus VARCHAR(30) NOT NULL, \n\tstage VARCHAR(100) NOT NULL, \n\tpayload JSONB NOT NULL, \n\tresult JSONB NOT NULL, \n\terror TEXT NOT NULL, \n\tcancelled BOOLEAN NOT NULL, \n\tattempts INTEGER NOT NULL, \n\tupdated_at TIMESTAMP WITH TIME ZONE NOT NULL, \n\tid VARCHAR(36) NOT NULL, \n\tcreated_at TIMESTAMP WITH TIME ZONE NOT NULL, \n\tPRIMARY KEY (id), \n\tFOREIGN KEY(owner_id) REFERENCES users (id), \n\tFOREIGN KEY(project_id) REFERENCES projects (id)\n)\n\n",
    "\nCREATE TABLE project_members (\n\tproject_id VARCHAR(36) NOT NULL, \n\tuser_id VARCHAR(36) NOT NULL, \n\tresponsibility TEXT NOT NULL, \n\tid VARCHAR(36) NOT NULL, \n\tcreated_at TIMESTAMP WITH TIME ZONE NOT NULL, \n\tPRIMARY KEY (id), \n\tUNIQUE (project_id, user_id), \n\tFOREIGN KEY(project_id) REFERENCES projects (id), \n\tFOREIGN KEY(user_id) REFERENCES users (id)\n)\n\n",
    "\nCREATE TABLE exports (\n\tproject_id VARCHAR(36) NOT NULL, \n\tactor_id VARCHAR(36) NOT NULL, \n\tmanifest JSONB NOT NULL, \n\tasset_id VARCHAR(36) NOT NULL, \n\tdraft BOOLEAN NOT NULL, \n\tid VARCHAR(36) NOT NULL, \n\tcreated_at TIMESTAMP WITH TIME ZONE NOT NULL, \n\tPRIMARY KEY (id), \n\tFOREIGN KEY(project_id) REFERENCES projects (id), \n\tFOREIGN KEY(actor_id) REFERENCES users (id), \n\tFOREIGN KEY(asset_id) REFERENCES assets (id)\n)\n\n",
    "\nCREATE TABLE job_events (\n\tjob_id VARCHAR(36) NOT NULL, \n\tdata JSONB NOT NULL, \n\tid VARCHAR(36) NOT NULL, \n\tcreated_at TIMESTAMP WITH TIME ZONE NOT NULL, \n\tPRIMARY KEY (id), \n\tFOREIGN KEY(job_id) REFERENCES jobs (id)\n)\n\n",
    "\nCREATE TABLE pages (\n\tbooklet_id VARCHAR(36) NOT NULL, \n\ttitle VARCHAR(200) NOT NULL, \n\tposition INTEGER NOT NULL, \n\tcurrent_revision_id VARCHAR(36), \n\tdeleted BOOLEAN NOT NULL, \n\ttemplate_version_id VARCHAR(36), \n\tid VARCHAR(36) NOT NULL, \n\tcreated_at TIMESTAMP WITH TIME ZONE NOT NULL, \n\tPRIMARY KEY (id), \n\tFOREIGN KEY(booklet_id) REFERENCES booklets (id)\n)\n\n",
    "\nCREATE TABLE submissions (\n\tbooklet_id VARCHAR(36) NOT NULL, \n\tactor_id VARCHAR(36) NOT NULL, \n\tmanifest JSONB NOT NULL, \n\tstatus VARCHAR(30) NOT NULL, \n\treview_comment TEXT NOT NULL, \n\treviewer_id VARCHAR(36), \n\treviewed_at TIMESTAMP WITH TIME ZONE, \n\tid VARCHAR(36) NOT NULL, \n\tcreated_at TIMESTAMP WITH TIME ZONE NOT NULL, \n\tPRIMARY KEY (id), \n\tFOREIGN KEY(booklet_id) REFERENCES booklets (id), \n\tFOREIGN KEY(actor_id) REFERENCES users (id), \n\tFOREIGN KEY(reviewer_id) REFERENCES users (id)\n)\n\n",
    "\nCREATE TABLE page_revisions (\n\tpage_id VARCHAR(36) NOT NULL, \n\tdocument JSONB NOT NULL, \n\tactor_id VARCHAR(36) NOT NULL, \n\tsource VARCHAR(30) NOT NULL, \n\tbase_revision_id VARCHAR(36), \n\tid VARCHAR(36) NOT NULL, \n\tcreated_at TIMESTAMP WITH TIME ZONE NOT NULL, \n\tPRIMARY KEY (id), \n\tFOREIGN KEY(page_id) REFERENCES pages (id), \n\tFOREIGN KEY(actor_id) REFERENCES users (id)\n)\n\n",
    "\nCREATE TABLE library_pages (\n\towner_id VARCHAR(36) NOT NULL, \n\ttitle VARCHAR(200) NOT NULL, \n\trevision_id VARCHAR(36) NOT NULL, \n\tid VARCHAR(36) NOT NULL, \n\tcreated_at TIMESTAMP WITH TIME ZONE NOT NULL, \n\tPRIMARY KEY (id), \n\tFOREIGN KEY(owner_id) REFERENCES users (id), \n\tFOREIGN KEY(revision_id) REFERENCES page_revisions (id)\n)\n\n",
]


def upgrade():
    for statement in DDL:
        op.execute(statement)


def downgrade():
    op.drop_table("library_pages")
    op.drop_table("page_revisions")
    op.drop_table("submissions")
    op.drop_table("pages")
    op.drop_table("job_events")
    op.drop_table("exports")
    op.drop_table("project_members")
    op.drop_table("jobs")
    op.drop_table("booklets")
    op.drop_table("assets")
    op.drop_table("template_versions")
    op.drop_table("sessions")
    op.drop_table("projects")
    op.drop_table("notifications")
    op.drop_table("audit_events")
    op.drop_table("users")
    op.drop_table("templates")
    op.drop_table("template_categories")
    op.drop_table("departments")
