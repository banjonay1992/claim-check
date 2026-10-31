# Sample Scripts

```sh claim-check:run
echo hello > out.txt
test -f out.txt
```

<!-- claim-check:run exit=3 -->
```bash
exit 3
```

```console claim-check:run
$ echo ok
ok
$ echo continued \
  line
continued line
```

<!-- claim-check:run cwd=sub timeout=10s -->
```sh
test -f marker.txt
```

This block is not marked, so it is never run:

```sh
false
```
