import express from 'express';
import registerRoutes from './routes/register.routes.js';
import bodyParser from 'body-parser';
import cors from 'cors';
const app = express();



app.use(bodyParser.json());
app.use(express.json()); 




app.use(express.urlencoded({ extended: true }));

app.use(
  cors({
    credentials: true,
    origin: "http://localhost:3000",
  }),
);
// ✅ Register routes (multer inside controller will handle multipart/form-data)
app.use('/register', registerRoutes);

app.get('/test', (req, res) => {
  const {name} = req.body;
  res.send(`Hello ${name}`);
});


app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Something broke!');
});

app.listen(4000, () => {
  console.log('🚀 Server running at http://localhost:4000');
  console.log('✅ Connected to MySQL');
});
