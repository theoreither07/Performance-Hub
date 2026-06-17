"use client";

import * as React from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createProjectLocal, updateProjectLocal } from "@/lib/sync/local-mutations";
import { LIFE_AREAS, type LifeArea } from "@/types/domain";
import type { LocalProject } from "@/lib/db/dexie";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project?: LocalProject;
}

export function ProjectDialog({ open, onOpenChange, project }: Props) {
  const editing = Boolean(project);

  const [name, setName] = React.useState("");
  const [area, setArea] = React.useState<LifeArea>("BUSINESS");
  const [description, setDescription] = React.useState("");
  const [contactName, setContactName] = React.useState("");
  const [contactEmail, setContactEmail] = React.useState("");
  const [contactPhone, setContactPhone] = React.useState("");
  const [color, setColor] = React.useState("#AAFF00");
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setName(project?.name ?? "");
      setArea(project?.area ?? "BUSINESS");
      setDescription(project?.description ?? "");
      setContactName(project?.contactName ?? "");
      setContactEmail(project?.contactEmail ?? "");
      setContactPhone(project?.contactPhone ?? "");
      setColor(project?.color ?? "#AAFF00");
    }
  }, [open, project]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      const payload = {
        name: name.trim(),
        area,
        description: description.trim() || undefined,
        contactName: contactName.trim() || undefined,
        contactEmail: contactEmail.trim() || undefined,
        contactPhone: contactPhone.trim() || undefined,
        color,
      };
      if (editing && project) {
        await updateProjectLocal(project.id, payload);
      } else {
        await createProjectLocal(payload);
      }
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "Projekt bearbeiten" : "Neues Projekt"}</DialogTitle>
          <DialogDescription>
            Name, Bereich und Ansprechpartner. Spaeter kannst du Tasks zuordnen.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground">Projektname</label>
            <Input
              autoFocus
              placeholder="z.B. Website Relaunch"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">Bereich</label>
              <Select value={area} onValueChange={(v) => setArea(v as LifeArea)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {LIFE_AREAS.map((a) => (
                    <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Farbe</label>
              <Input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-10 p-1 cursor-pointer" />
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Beschreibung</label>
            <Textarea
              placeholder="Worum geht's? Was ist das Ziel?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>

          <div className="pt-2">
            <p className="text-xs font-medium text-muted-foreground mb-2">Ansprechpartner (optional)</p>
            <div className="space-y-2">
              <Input
                placeholder="Name"
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
              />
              <div className="grid grid-cols-2 gap-2">
                <Input
                  type="email"
                  placeholder="E-Mail"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                />
                <Input
                  type="tel"
                  placeholder="Telefon"
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Abbrechen</Button>
            <Button type="submit" disabled={submitting || !name.trim()}>
              {submitting ? "Speichere..." : editing ? "Speichern" : "Anlegen"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
