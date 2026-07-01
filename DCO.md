Developer Certificate of Origin
Version 1.1

Copyright (C) 2004, 2006 The Linux Foundation and its contributors.
1 Letterman Drive
Suite D4700
San Francisco, CA, 94129

Everyone is permitted to copy and distribute verbatim copies of this
license document, but changing it is not allowed.

Developer's Certificate of Origin 1.1

By making a contribution to this project, I certify that:

(a) The contribution was created in whole or in part by me and I
have the right to submit it under the open source license
indicated in the file; or

(b) The contribution is based upon previous work that, to the best
of my knowledge, is covered under an appropriate open source
license and I have the right under that license to submit that
work with modifications, whether created in whole or in part
by me, under the same open source license (unless I am
permitted to submit under a different license), as indicated
in the file; or

(c) The contribution was provided directly to me by some other
person who certified (a), (b) or (c) and I have not modified
it.

(d) I understand and agree that this project and the contribution
are public and that a record of the contribution (including all
personal information I submit with it, including my sign-off) is
maintained indefinitely and may be redistributed consistent with
this project or the open source license(s) involved.

---

## How to sign off a commit

Every commit contributed to this project must include a `Signed-off-by`
trailer certifying the statement above. Add it automatically with the
`-s` (or `--signoff`) flag:

```bash
git commit -s -m "Add feature: description"
```

This appends a line to the commit message in the form:

```
Signed-off-by: Your Name <your.email@example.com>
```

Use your real name and a reachable email address — anonymous or pseudonymous
sign-offs are not accepted.

If you forgot to sign off a commit, amend it:

```bash
git commit --amend -s
```

For multiple commits on a branch, sign off all of them at once:

```bash
git rebase --signoff origin/main
```

Pull requests are checked automatically for this trailer (see
`.github/workflows/dco.yml`); PRs with unsigned commits will fail the
`DCO` status check and cannot be merged until every commit is signed off.
