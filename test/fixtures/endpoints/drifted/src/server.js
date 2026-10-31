const router = express.Router();
router.get('/users/:id', handler);
router.put('/users/:id', handler);
app.use('/api', router);
