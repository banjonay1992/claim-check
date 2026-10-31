# Sample Scripts

```sh claim-check:run
echo "about to fail"
false
```

```sh claim-check:run timeout=300ms
sleep 5
```

<!-- claim-check:run exit=0 -->
```bash
exit 2
```

```js claim-check:run
console.log('not a shell block');
```

<!-- claim-check:run cwd=missing-dir -->
```sh
true
```
